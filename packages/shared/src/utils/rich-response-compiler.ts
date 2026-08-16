import {
  parseResponseDocument,
  responseDocumentPart,
  responseDocumentToMarkdown,
  type ResponseBlockV1,
  type ResponseDocumentV1,
} from './response-document.js';
import { parseChartSpec } from './chart-spec.js';

export const RICH_RESPONSE_COMPILE_DEADLINE_MS = 1_500;
export const RICH_RESPONSE_MAX_SOURCE_CHARS = 80_000;
export const RICH_RESPONSE_MIN_PARITY = 0.86;

export interface RichResponseCompileInput {
  content: string;
  category?: string;
  outputMode?: 'brief' | 'moderate' | 'detailed';
  revision?: number;
}

export type RichResponseCompileResult =
  | {
    selected: true;
    document: ResponseDocumentV1;
    fallbackMarkdown: string;
    parity: number;
    elapsedMs: number;
    reason: string;
  }
  | {
    selected: false;
    elapsedMs: number;
    reason: string;
    error?: string;
  };

const RICH_CATEGORY_RE = /\b(analysis|audit|comparison|report|plan|architecture|finance|shopping|research|review)\b/i;
const RICH_CONTENT_RE = /\b(compare|comparison|trade-?off|impact|findings?|evidence|verdict|metrics?|timeline|roadmap|risk|recommendation|implementation plan)\b/i;
const HEADING_RE = /^#{1,4}\s+\S/m;
const TABLE_RE = /^\s*\|.+\|\s*$/m;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}[-:|\s]*\|?\s*$/m;
const METRIC_RE = /(?:^|\n)\s*(?:[-*]\s*)?\*\*[^*\n]{1,80}\*\*\s*(?:—|-|:)\s*\S/g;

export function shouldCompileRichResponse(input: RichResponseCompileInput): {
  selected: boolean;
  reason: string;
} {
  const content = input.content.trim();
  if (!content) return { selected: false, reason: 'empty' };
  if (input.outputMode === 'brief' && content.length < 900) return { selected: false, reason: 'brief-output' };
  const hasTable = TABLE_RE.test(content) && TABLE_SEPARATOR_RE.test(content);
  const headingCount = content.split('\n').filter((line) => /^#{1,4}\s+\S/.test(line.trim())).length;
  const metricCount = content.match(METRIC_RE)?.length ?? 0;
  const hasStructuredFence = /```(?:chart|graph|viz|mermaid|json|[a-z0-9_+-]+)\s*\n/i.test(content);
  if (hasTable) return { selected: true, reason: 'table' };
  if (metricCount >= 2) return { selected: true, reason: 'metrics' };
  if (hasStructuredFence && headingCount >= 1) return { selected: true, reason: 'structured-code' };
  if (headingCount >= 2 && content.length >= 450) return { selected: true, reason: 'multi-section' };
  if (
    content.length >= 650
    && (RICH_CATEGORY_RE.test(input.category || '') || RICH_CONTENT_RE.test(content))
    && HEADING_RE.test(content)
  ) {
    return { selected: true, reason: 'analytical-report' };
  }
  return { selected: false, reason: 'plain-answer' };
}

function parseCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|{2,}/, '|').replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function isTableSeparator(line: string): boolean {
  const cells = parseCells(line).filter((cell) => cell.length > 0);
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

function readTable(lines: string[], start: number): {
  block: Extract<ResponseBlockV1, { type: 'table' }>;
  next: number;
} | null {
  if (!lines[start]?.trim().startsWith('|')) return null;
  if (!lines[start + 1] || !isTableSeparator(lines[start + 1]!)) return null;
  const headers = parseCells(lines[start]!);
  const rows: Array<Array<string | number | boolean | null>> = [];
  let cursor = start + 2;
  while (cursor < lines.length && lines[cursor]!.trim().startsWith('|')) {
    const cells = parseCells(lines[cursor]!);
    rows.push(headers.map((_, index) => cells[index] ?? ''));
    cursor++;
  }
  return {
    block: {
      type: 'table',
      headers,
      rows,
      striped: rows.length >= 4,
    },
    next: cursor,
  };
}

function readFence(lines: string[], start: number): {
  block: ResponseBlockV1;
  next: number;
} | null {
  const opener = /^```([a-z0-9_+-]*)\s*$/i.exec(lines[start]!.trim());
  if (!opener) return null;
  const language = (opener[1] || 'text').toLowerCase();
  const body: string[] = [];
  let cursor = start + 1;
  while (cursor < lines.length && !/^```\s*$/.test(lines[cursor]!.trim())) {
    body.push(lines[cursor]!);
    cursor++;
  }
  const code = body.join('\n');
  if (['chart', 'graph', 'viz', 'mermaid'].includes(language)) {
    const parsed = parseChartSpec(code);
    if (parsed.ok) {
      return {
        block: {
          type: 'chart',
          spec: parsed.spec,
          summary: parsed.spec.subtitle || parsed.spec.title,
        },
        next: Math.min(lines.length, cursor + 1),
      };
    }
  }
  return {
    block: { type: 'code', language, code },
    next: Math.min(lines.length, cursor + 1),
  };
}

function flushParagraph(buffer: string[], blocks: ResponseBlockV1[]): void {
  const content = buffer.join('\n').trim();
  buffer.length = 0;
  if (!content) return;
  blocks.push({ type: 'text', content });
}

function extractStats(lines: string[], start: number): {
  block: Extract<ResponseBlockV1, { type: 'stat_grid' }>;
  next: number;
} | null {
  const stats: Extract<ResponseBlockV1, { type: 'stat_grid' }>['stats'] = [];
  let cursor = start;
  while (cursor < lines.length && stats.length < 6) {
    const line = lines[cursor]!.trim();
    const match = /^(?:[-*]\s*)?\*\*([^*]{1,80})\*\*\s*(?:—|-|:)\s*(.+)$/.exec(line);
    if (!match) break;
    stats.push({ value: match[1]!.trim(), label: match[2]!.trim() });
    cursor++;
  }
  if (stats.length < 2) return null;
  return {
    block: {
      type: 'stat_grid',
      columns: stats.length >= 4 ? 4 : stats.length === 3 ? 3 : 2,
      stats,
    },
    next: cursor,
  };
}

function documentFromMarkdown(input: RichResponseCompileInput): ResponseDocumentV1 {
  const lines = input.content.replace(/\r\n/g, '\n').split('\n');
  const blocks: ResponseBlockV1[] = [];
  const paragraph: string[] = [];
  let title: string | undefined;
  let cursor = 0;

  while (cursor < lines.length) {
    const line = lines[cursor]!;
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph(paragraph, blocks);
      cursor++;
      continue;
    }

    const fence = readFence(lines, cursor);
    if (fence) {
      flushParagraph(paragraph, blocks);
      blocks.push(fence.block);
      cursor = fence.next;
      continue;
    }

    const table = readTable(lines, cursor);
    if (table) {
      flushParagraph(paragraph, blocks);
      blocks.push(table.block);
      cursor = table.next;
      continue;
    }

    const stats = extractStats(lines, cursor);
    if (stats) {
      flushParagraph(paragraph, blocks);
      blocks.push(stats.block);
      cursor = stats.next;
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph(paragraph, blocks);
      if (!title && heading[1]!.length <= 2) {
        title = heading[2]!.trim();
      } else {
        const level = Math.min(4, Math.max(2, heading[1]!.length)) as 2 | 3 | 4;
        blocks.push({ type: 'heading', level, text: heading[2]!.trim() });
      }
      cursor++;
      continue;
    }

    if (trimmed.startsWith('>')) {
      flushParagraph(paragraph, blocks);
      const quoted: string[] = [];
      while (cursor < lines.length && lines[cursor]!.trim().startsWith('>')) {
        quoted.push(lines[cursor]!.trim().replace(/^>\s?/, ''));
        cursor++;
      }
      const calloutText = quoted.join('\n').trim();
      const titleMatch = /^\*\*([^*]+)\*\*\s*(.*)$/s.exec(calloutText);
      blocks.push({
        type: 'callout',
        tone: 'info',
        ...(titleMatch ? {
          title: titleMatch[1]!.trim(),
          content: titleMatch[2]!.trim(),
        } : { content: calloutText }),
      });
      continue;
    }

    const checklistMatch = /^[-*]\s+\[([ xX])\]\s+(.+)$/.exec(trimmed);
    if (checklistMatch) {
      flushParagraph(paragraph, blocks);
      const items: Extract<ResponseBlockV1, { type: 'checklist' }>['items'] = [];
      while (cursor < lines.length) {
        const item = /^[-*]\s+\[([ xX])\]\s+(.+)$/.exec(lines[cursor]!.trim());
        if (!item) break;
        items.push({
          text: item[2]!.trim(),
          status: item[1]!.toLowerCase() === 'x' ? 'done' : 'pending',
        });
        cursor++;
      }
      blocks.push({ type: 'checklist', items });
      continue;
    }

    paragraph.push(line);
    cursor++;
  }
  flushParagraph(paragraph, blocks);

  return {
    version: 1,
    revision: input.revision ?? 1,
    ...(title ? { title } : {}),
    density: 'compact',
    blocks: blocks.slice(0, 80),
  };
}

function semanticTokens(text: string): Set<string> {
  const stopWords = new Set([
    'and', 'the', 'this', 'that', 'with', 'from', 'into', 'for', 'are', 'was',
    'were', 'will', 'has', 'have', 'had', 'but', 'not', 'you', 'your',
  ]);
  return new Set(
    (text
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .match(/[a-z0-9][a-z0-9._%+-]{1,}/g) ?? [])
      .map((token) => token.replace(/^[._+-]+|[._+-]+$/g, ''))
      .filter((token) => token.length > 2 && !stopWords.has(token)),
  );
}

export function responseDocumentSemanticParity(source: string, renderedMarkdown: string): number {
  const expected = semanticTokens(source);
  if (expected.size === 0) return 1;
  const actual = semanticTokens(renderedMarkdown);
  let matched = 0;
  for (const token of expected) {
    if (actual.has(token)) matched++;
  }
  return matched / expected.size;
}

export function compileRichResponseDocument(input: RichResponseCompileInput): RichResponseCompileResult {
  const started = Date.now();
  const selection = shouldCompileRichResponse(input);
  if (!selection.selected) {
    return { selected: false, elapsedMs: Date.now() - started, reason: selection.reason };
  }
  if (input.content.length > RICH_RESPONSE_MAX_SOURCE_CHARS) {
    return { selected: false, elapsedMs: Date.now() - started, reason: 'source-too-large' };
  }

  try {
    const document = documentFromMarkdown(input);
    const parsed = parseResponseDocument(document);
    if (!parsed.ok) {
      return {
        selected: false,
        elapsedMs: Date.now() - started,
        reason: 'validation-failed',
        error: parsed.error,
      };
    }
    const serialized = responseDocumentToMarkdown(parsed.document);
    const parity = responseDocumentSemanticParity(input.content, serialized);
    const elapsedMs = Date.now() - started;
    if (elapsedMs > RICH_RESPONSE_COMPILE_DEADLINE_MS) {
      return {
        selected: false,
        elapsedMs,
        reason: 'compile-deadline-exceeded',
      };
    }
    if (parity < RICH_RESPONSE_MIN_PARITY) {
      return {
        selected: false,
        elapsedMs,
        reason: 'semantic-parity-failed',
        error: parity.toFixed(3),
      };
    }
    return {
      selected: true,
      document: parsed.document,
      fallbackMarkdown: input.content.trim(),
      parity,
      elapsedMs,
      reason: selection.reason,
    };
  } catch (error) {
    return {
      selected: false,
      elapsedMs: Date.now() - started,
      reason: 'compiler-error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function compileRichResponsePart(
  id: string,
  input: RichResponseCompileInput,
): ReturnType<typeof responseDocumentPart> {
  const result = compileRichResponseDocument(input);
  if (!result.selected) return null;
  return responseDocumentPart(id, result.document, result.fallbackMarkdown);
}
