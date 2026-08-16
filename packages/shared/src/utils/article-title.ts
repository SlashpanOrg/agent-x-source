import {
  displayArticleTitle,
  isGfmTableRow,
  isGfmTableSeparator,
  parseGfmTableCells,
} from './article-table.js';

export interface DeriveArticleTitleInput {
  title?: string;
  contentTsx?: string;
  content?: string;
}

const GENERIC_TITLES = new Set([
  'canvas',
  'markdown',
  'article',
  'articles',
  'untitled',
  'untitled canvas',
  'untitled markdown',
  'untitled article',
  'saved message',
  'saved canvas',
  'saved markdown',
  'saved article',
  'savedcanvas',
  'new canvas',
  'my canvas',
  'document',
  'report',
]);

export function isGenericArticleTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase().replace(/\s+/g, ' ');
  return !normalized || GENERIC_TITLES.has(normalized);
}

function humanizeComponentName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

function cleanTitleCandidate(raw: string): string | null {
  const title = raw
    .replace(/\s+/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim()
    .slice(0, 200);
  if (!title || isGenericArticleTitle(title)) return null;
  return title;
}

function titleFromTsx(content: string): string | null {
  const sectionPatterns = [
    /<Section[^>]*\btitle\s*=\s*["']([^"']+)["']/i,
    /<Section[^>]*\btitle\s*=\s*\{\s*["']([^"']+)["']\s*\}/i,
    /<Section[^>]*\btitle\s*=\s*\{\s*`([^`]+)`\s*\}/i,
    /<Card[^>]*\btitle\s*=\s*["']([^"']+)["']/i,
  ];
  for (const pattern of sectionPatterns) {
    const match = content.match(pattern);
    const candidate = match?.[1] ? cleanTitleCandidate(match[1]) : null;
    if (candidate) return candidate;
  }

  const fnMatch = content.match(/export\s+default\s+function\s+(\w+)/);
  if (fnMatch?.[1] && fnMatch[1] !== 'SavedCanvas') {
    const candidate = cleanTitleCandidate(humanizeComponentName(fnMatch[1]));
    if (candidate) return candidate;
  }

  const chartTitleMatch = content.match(/["']title["']\s*:\s*["']([^"']+)["']/i)
    ?? content.match(/["']title["']\s*:\s*`([^`]+)`/i);
  if (chartTitleMatch?.[1]) {
    const candidate = cleanTitleCandidate(chartTitleMatch[1]);
    if (candidate) return candidate;
  }

  return null;
}

function titleFromChartFence(content: string): string | null {
  const fence = content.match(/```chart\s*([\s\S]*?)```/i);
  if (!fence?.[1]) return null;
  try {
    const spec = JSON.parse(fence[1].trim()) as { title?: unknown };
    if (typeof spec.title === 'string') {
      return cleanTitleCandidate(spec.title);
    }
  } catch {
    const inline = fence[1].match(/["']title["']\s*:\s*["']([^"']+)["']/i);
    if (inline?.[1]) return cleanTitleCandidate(inline[1]);
  }
  return null;
}

function firstTableHeaderTitle(content: string): string | null {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  let inFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]!.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !trimmed || isGfmTableSeparator(trimmed)) continue;
    if (!isGfmTableRow(trimmed)) continue;
    const next = lines[index + 1]?.trim() ?? '';
    if (!isGfmTableSeparator(next) && !(next && isGfmTableRow(next))) continue;
    const cells = parseGfmTableCells(trimmed).filter(Boolean);
    if (cells.length < 2) continue;
    return cleanTitleCandidate(cells.join(' · '));
  }
  return null;
}

function titleFromBody(content: string): string | null {
  const chartTitle = titleFromChartFence(content);
  if (chartTitle) return chartTitle;

  const heading = content.match(/^#{1,3}\s+(.+)$/m);
  if (heading?.[1] && !isGfmTableRow(heading[1])) {
    const candidate = cleanTitleCandidate(heading[1]);
    if (candidate) return candidate;
  }

  const lines = content.replace(/\r\n/g, '\n').split('\n');
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !trimmed) continue;
    if (isGfmTableRow(trimmed) || isGfmTableSeparator(trimmed)) continue;
    if (/^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) continue;
    const plain = trimmed
      .replace(/[#>*_`~[\]()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!plain) continue;
    const sentence = plain.split(/(?<=[.!?])\s+/)[0] ?? plain;
    const words = sentence.split(' ').filter(Boolean).slice(0, 10).join(' ');
    const candidate = cleanTitleCandidate(words);
    if (candidate) return candidate;
  }

  return firstTableHeaderTitle(content);
}

/** Derive a human-readable article title from explicit title and/or content. */
export function deriveArticleTitle(input: DeriveArticleTitleInput): string {
  const explicit = input.title?.trim();
  if (explicit && !isGenericArticleTitle(explicit) && !isGfmTableRow(explicit)) {
    return displayArticleTitle(explicit) || explicit.slice(0, 200);
  }

  const tsx = input.contentTsx?.trim();
  if (tsx) {
    const fromTsx = titleFromTsx(tsx);
    if (fromTsx) return fromTsx;
  }

  const body = input.content?.trim();
  if (body) {
    const fromBody = titleFromBody(body);
    if (fromBody) return fromBody;
  }

  if (tsx) {
    const fromWrapped = titleFromBody(tsx);
    if (fromWrapped) return fromWrapped;
  }

  if (explicit) {
    const fromExplicit = displayArticleTitle(explicit);
    if (fromExplicit) return fromExplicit;
  }
  return 'Article';
}
