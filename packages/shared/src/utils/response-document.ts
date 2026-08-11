import { z } from 'zod';
import { ChartSpecSchema, type ChartSpec } from './chart-spec.js';

export const RESPONSE_DOCUMENT_VERSION = 1 as const;
export const MAX_RESPONSE_DOCUMENT_BYTES = 256 * 1024;
export const MAX_RESPONSE_BLOCKS = 80;
export const MAX_RESPONSE_TABLE_CELLS = 2_400;

export const ResponseToneSchema = z.enum(['neutral', 'info', 'success', 'warning', 'danger']);
export type ResponseTone = z.infer<typeof ResponseToneSchema>;

const BlockIdSchema = z.string().min(1).max(80).optional();
const ShortTextSchema = z.string().max(500);
const BodyTextSchema = z.string().max(20_000);
const CellSchema = z.union([z.string().max(4_000), z.number(), z.boolean(), z.null()]);

const TextBlockSchema = z.object({
  type: z.literal('text'),
  id: BlockIdSchema,
  content: BodyTextSchema,
}).strict();

const HeadingBlockSchema = z.object({
  type: z.literal('heading'),
  id: BlockIdSchema,
  level: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(2),
  text: z.string().min(1).max(240),
}).strict();

const DividerBlockSchema = z.object({
  type: z.literal('divider'),
  id: BlockIdSchema,
}).strict();

const CalloutBlockSchema = z.object({
  type: z.literal('callout'),
  id: BlockIdSchema,
  tone: ResponseToneSchema.default('info'),
  title: z.string().max(160).optional(),
  content: BodyTextSchema,
}).strict();

const StatSchema = z.object({
  label: z.string().min(1).max(160),
  value: z.union([z.string().max(80), z.number()]),
  detail: z.string().max(240).optional(),
  tone: ResponseToneSchema.optional(),
}).strict();

const StatGridBlockSchema = z.object({
  type: z.literal('stat_grid'),
  id: BlockIdSchema,
  columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
  stats: z.array(StatSchema).min(1).max(6),
}).strict();

const ComparisonItemSchema = z.object({
  title: z.string().min(1).max(160),
  badge: z.string().max(60).optional(),
  body: z.string().max(4_000).optional(),
  bullets: z.array(z.string().max(500)).max(12).optional(),
  tone: ResponseToneSchema.optional(),
}).strict();

const ComparisonBlockSchema = z.object({
  type: z.literal('comparison'),
  id: BlockIdSchema,
  title: z.string().max(180).optional(),
  items: z.array(ComparisonItemSchema).min(2).max(3),
}).strict();

const TableBlockSchema = z.object({
  type: z.literal('table'),
  id: BlockIdSchema,
  title: z.string().max(180).optional(),
  caption: z.string().max(300).optional(),
  headers: z.array(z.string().max(160)).min(1).max(12),
  rows: z.array(z.array(CellSchema).max(12)).max(200),
  align: z.array(z.enum(['left', 'center', 'right'])).max(12).optional(),
  striped: z.boolean().optional(),
}).strict();

const ChartBlockSchema = z.object({
  type: z.literal('chart'),
  id: BlockIdSchema,
  spec: ChartSpecSchema,
  caption: z.string().max(300).optional(),
  summary: z.string().max(1_000).optional(),
}).strict();

const KeyValueBlockSchema = z.object({
  type: z.literal('key_value'),
  id: BlockIdSchema,
  title: z.string().max(180).optional(),
  items: z.array(z.object({
    label: z.string().min(1).max(160),
    value: z.union([z.string().max(2_000), z.number(), z.boolean()]),
    detail: z.string().max(500).optional(),
  }).strict()).min(1).max(20),
}).strict();

const ChecklistBlockSchema = z.object({
  type: z.literal('checklist'),
  id: BlockIdSchema,
  title: z.string().max(180).optional(),
  items: z.array(z.object({
    text: z.string().min(1).max(1_000),
    status: z.enum(['pending', 'in_progress', 'done', 'skipped']).default('pending'),
    detail: z.string().max(1_000).optional(),
  }).strict()).min(1).max(100),
}).strict();

const TimelineBlockSchema = z.object({
  type: z.literal('timeline'),
  id: BlockIdSchema,
  title: z.string().max(180).optional(),
  items: z.array(z.object({
    title: z.string().min(1).max(240),
    time: z.string().max(120).optional(),
    description: z.string().max(2_000).optional(),
    tone: ResponseToneSchema.optional(),
  }).strict()).min(1).max(50),
}).strict();

const CodeBlockSchema = z.object({
  type: z.literal('code'),
  id: BlockIdSchema,
  title: z.string().max(180).optional(),
  language: z.string().max(40).default('text'),
  code: z.string().max(20_000),
}).strict();

const SafeHttpsUrlSchema = z.string().url().max(2_048).refine((raw) => {
  try {
    return new URL(raw).protocol === 'https:';
  } catch {
    return false;
  }
}, 'unsafe-response-link');

const LinkListBlockSchema = z.object({
  type: z.literal('link_list'),
  id: BlockIdSchema,
  title: z.string().max(180).optional(),
  links: z.array(z.object({
    label: z.string().min(1).max(240),
    href: SafeHttpsUrlSchema,
    description: z.string().max(500).optional(),
  }).strict()).min(1).max(100),
}).strict();

const ResponseLeafBlockSchema = z.discriminatedUnion('type', [
  TextBlockSchema,
  HeadingBlockSchema,
  DividerBlockSchema,
  CalloutBlockSchema,
  StatGridBlockSchema,
  ComparisonBlockSchema,
  TableBlockSchema,
  ChartBlockSchema,
  KeyValueBlockSchema,
  ChecklistBlockSchema,
  TimelineBlockSchema,
  CodeBlockSchema,
  LinkListBlockSchema,
]);

const CollapsibleBlockSchema = z.object({
  type: z.literal('collapsible'),
  id: BlockIdSchema,
  title: z.string().min(1).max(180),
  summary: z.string().max(500).optional(),
  defaultOpen: z.boolean().optional(),
  blocks: z.array(ResponseLeafBlockSchema).min(1).max(20),
}).strict();

export const ResponseBlockSchema = z.discriminatedUnion('type', [
  TextBlockSchema,
  HeadingBlockSchema,
  DividerBlockSchema,
  CalloutBlockSchema,
  StatGridBlockSchema,
  ComparisonBlockSchema,
  TableBlockSchema,
  ChartBlockSchema,
  KeyValueBlockSchema,
  ChecklistBlockSchema,
  TimelineBlockSchema,
  CodeBlockSchema,
  LinkListBlockSchema,
  CollapsibleBlockSchema,
]);

export type ResponseBlockV1 = z.infer<typeof ResponseBlockSchema>;

export const ResponseDocumentSchema = z.object({
  version: z.literal(RESPONSE_DOCUMENT_VERSION),
  /** Monotonic snapshot revision. Later revisions replace earlier ones. */
  revision: z.number().int().min(1).max(1_000_000).default(1),
  title: z.string().max(240).optional(),
  subtitle: ShortTextSchema.optional(),
  status: ResponseToneSchema.optional(),
  density: z.enum(['compact', 'comfortable']).default('compact'),
  blocks: z.array(ResponseBlockSchema).min(1).max(MAX_RESPONSE_BLOCKS),
  sourceCaption: z.string().max(500).optional(),
}).strict().superRefine((document, ctx) => {
  let tableCells = 0;
  for (const block of document.blocks) {
    if (block.type !== 'table') continue;
    tableCells += block.headers.length;
    tableCells += block.rows.reduce((sum, row) => sum + row.length, 0);
  }
  if (tableCells > MAX_RESPONSE_TABLE_CELLS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'response-table-cell-limit-exceeded',
      path: ['blocks'],
    });
  }
});

export type ResponseDocumentV1 = z.infer<typeof ResponseDocumentSchema>;

export type ResponseDocumentParseResult =
  | { ok: true; document: ResponseDocumentV1 }
  | { ok: false; error: string };

function serializedByteLength(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(json).byteLength;
    return json.length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function parseResponseDocument(value: unknown): ResponseDocumentParseResult {
  if (serializedByteLength(value) > MAX_RESPONSE_DOCUMENT_BYTES) {
    return { ok: false, error: 'response-document-too-large' };
  }
  const parsed = ResponseDocumentSchema.safeParse(value);
  if (parsed.success) return { ok: true, document: parsed.data };

  // Forward-compatible v1 restore: omit individually unsupported blocks while
  // keeping trusted siblings. Top-level fields remain strict and unknown
  // document versions always use the canonical Markdown fallback.
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: parsed.error.issues[0]?.message || 'invalid-response-document' };
  }
  const raw = value as Record<string, unknown>;
  const allowedTopLevel = new Set([
    'version', 'revision', 'title', 'subtitle', 'status', 'density', 'blocks', 'sourceCaption',
  ]);
  if (Object.keys(raw).some((key) => !allowedTopLevel.has(key))) {
    return { ok: false, error: 'unrecognized-response-document-field' };
  }
  if (raw['version'] !== RESPONSE_DOCUMENT_VERSION || !Array.isArray(raw['blocks'])) {
    return { ok: false, error: parsed.error.issues[0]?.message || 'invalid-response-document' };
  }
  const validBlocks = raw['blocks'].flatMap((block) => {
    const blockResult = ResponseBlockSchema.safeParse(block);
    return blockResult.success ? [blockResult.data] : [];
  });
  if (validBlocks.length === 0) {
    return { ok: false, error: parsed.error.issues[0]?.message || 'invalid-response-document' };
  }
  const recovered = ResponseDocumentSchema.safeParse({
    ...raw,
    blocks: validBlocks,
  });
  if (!recovered.success) {
    return { ok: false, error: recovered.error.issues[0]?.message || 'invalid-response-document' };
  }
  return { ok: true, document: recovered.data };
}

function cellToMarkdown(value: string | number | boolean | null): string {
  if (value == null) return '';
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function chartSpecToMarkdown(spec: ChartSpec): string {
  return `\`\`\`chart\n${JSON.stringify(spec, null, 2)}\n\`\`\``;
}

export function responseDocumentToMarkdown(document: ResponseDocumentV1): string {
  const chunks: string[] = [];
  if (document.title) chunks.push(`# ${document.title}`);
  if (document.subtitle) chunks.push(`_${document.subtitle}_`);

  for (const block of document.blocks) {
    switch (block.type) {
      case 'text':
        chunks.push(block.content);
        break;
      case 'heading':
        chunks.push(`${'#'.repeat(block.level)} ${block.text}`);
        break;
      case 'divider':
        chunks.push('---');
        break;
      case 'callout': {
        const body = [block.title ? `**${block.title}**` : '', block.content]
          .filter(Boolean)
          .join('\n');
        chunks.push(body.split('\n').map((line) => `> ${line}`).join('\n'));
        break;
      }
      case 'stat_grid':
        chunks.push(block.stats.map((stat) => (
          `- **${cellToMarkdown(stat.value)}** — ${stat.label}${stat.detail ? `: ${stat.detail}` : ''}`
        )).join('\n'));
        break;
      case 'comparison':
        chunks.push([
          block.title ? `## ${block.title}` : '',
          ...block.items.map((item) => [
            `### ${item.title}${item.badge ? ` — ${item.badge}` : ''}`,
            item.body || '',
            ...(item.bullets?.map((bullet) => `- ${bullet}`) ?? []),
          ].filter(Boolean).join('\n')),
        ].filter(Boolean).join('\n\n'));
        break;
      case 'table': {
        const headers = block.headers.map(cellToMarkdown);
        const rows = block.rows.map((row) => (
          headers.map((_, index) => cellToMarkdown(row[index] ?? '')).join(' | ')
        ));
        chunks.push([
          block.title ? `### ${block.title}` : '',
          `| ${headers.join(' | ')} |`,
          `| ${headers.map(() => '---').join(' | ')} |`,
          ...rows.map((row) => `| ${row} |`),
          block.caption ? `_${block.caption}_` : '',
        ].filter(Boolean).join('\n'));
        break;
      }
      case 'chart':
        chunks.push([
          chartSpecToMarkdown(block.spec),
          block.summary || '',
          block.caption ? `_${block.caption}_` : '',
        ].filter(Boolean).join('\n'));
        break;
      case 'key_value':
        chunks.push([
          block.title ? `### ${block.title}` : '',
          ...block.items.map((item) => (
            `- **${item.label}:** ${cellToMarkdown(item.value)}${item.detail ? ` — ${item.detail}` : ''}`
          )),
        ].filter(Boolean).join('\n'));
        break;
      case 'checklist':
        chunks.push([
          block.title ? `### ${block.title}` : '',
          ...block.items.map((item) => {
            const checked = item.status === 'done' || item.status === 'skipped';
            const text = item.status === 'skipped'
              ? `~~${item.text}~~ _(skipped)_`
              : item.status === 'in_progress'
                ? `${item.text} _(in progress)_`
                : item.text;
            return `- [${checked ? 'x' : ' '}] ${text}${item.detail ? ` — ${item.detail}` : ''}`;
          }),
        ].filter(Boolean).join('\n'));
        break;
      case 'timeline':
        chunks.push([
          block.title ? `### ${block.title}` : '',
          ...block.items.map((item, index) => [
            `${index + 1}. **${item.title}**${item.time ? ` — ${item.time}` : ''}`,
            item.description ? `   ${item.description}` : '',
          ].filter(Boolean).join('\n')),
        ].filter(Boolean).join('\n'));
        break;
      case 'code':
        chunks.push([
          block.title ? `### ${block.title}` : '',
          `\`\`\`${block.language}\n${block.code}\n\`\`\``,
        ].filter(Boolean).join('\n'));
        break;
      case 'link_list':
        chunks.push([
          block.title ? `### ${block.title}` : '',
          ...block.links.map((link) => (
            `- [${link.label}](${link.href})${link.description ? ` — ${link.description}` : ''}`
          )),
        ].filter(Boolean).join('\n'));
        break;
      case 'collapsible':
        chunks.push([
          `### ${block.title}`,
          block.summary || '',
          responseDocumentToMarkdown({
            version: RESPONSE_DOCUMENT_VERSION,
            revision: 1,
            density: 'compact',
            blocks: block.blocks,
          }),
        ].filter(Boolean).join('\n\n'));
        break;
    }
  }

  if (document.sourceCaption) chunks.push(`_${document.sourceCaption}_`);
  return chunks.filter((chunk) => chunk.trim()).join('\n\n').trim();
}

export function responseDocumentPart(
  id: string,
  value: unknown,
  fallbackMarkdown?: string,
): {
  type: 'response_document';
  id: string;
  responseDocument: ResponseDocumentV1;
  fallbackMarkdown: string;
} | null {
  const parsed = parseResponseDocument(value);
  if (!parsed.ok) return null;
  return {
    type: 'response_document',
    id,
    responseDocument: parsed.document,
    fallbackMarkdown: fallbackMarkdown?.trim() || responseDocumentToMarkdown(parsed.document),
  };
}
