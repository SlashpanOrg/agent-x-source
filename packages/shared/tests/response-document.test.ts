import { describe, expect, it } from 'vitest';
import {
  MAX_RESPONSE_DOCUMENT_BYTES,
  parseResponseDocument,
  responseDocumentPart,
  responseDocumentToMarkdown,
} from '../src/utils/response-document.js';

const fixture = {
  version: 1 as const,
  title: 'Runtime comparison',
  subtitle: 'Validated fixture',
  status: 'success' as const,
  density: 'compact' as const,
  blocks: [
    {
      type: 'callout' as const,
      tone: 'info' as const,
      title: 'Verdict',
      content: 'The larger machine supports more parallel work.',
    },
    {
      type: 'stat_grid' as const,
      columns: 3 as const,
      stats: [
        { value: '2.3x', label: 'CPU uplift', tone: 'success' as const },
        { value: '8x', label: 'RAM uplift' },
      ],
    },
    {
      type: 'comparison' as const,
      items: [
        { title: 'Air', badge: 'Current', bullets: ['Balanced profile'] },
        { title: 'Pro', badge: 'Planned', bullets: ['Performance headroom'] },
      ],
    },
    {
      type: 'table' as const,
      title: 'Lane limits',
      headers: ['Machine', 'Workers'],
      rows: [['Air', 3], ['Pro', 7]],
      align: ['left' as const, 'right' as const],
      striped: true,
    },
    {
      type: 'chart' as const,
      spec: {
        type: 'bar' as const,
        title: 'Workers',
        data: [{ x: 'Air', y: 3 }, { x: 'Pro', y: 7 }],
      },
    },
  ],
  sourceCaption: 'Source: response unit fixture',
};

describe('response-document', () => {
  it('validates a compact analytical document', () => {
    const result = parseResponseDocument(fixture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.blocks).toHaveLength(5);
    expect(result.document.density).toBe('compact');
  });

  it('serializes the trusted document to portable Markdown', () => {
    const result = parseResponseDocument(fixture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const markdown = responseDocumentToMarkdown(result.document);
    expect(markdown).toContain('# Runtime comparison');
    expect(markdown).toContain('| Machine | Workers |');
    expect(markdown).toContain('```chart');
    expect(markdown).toContain('Source: response unit fixture');
  });

  it('builds a part with deterministic fallback Markdown', () => {
    const part = responseDocumentPart('rich-1', fixture);
    expect(part?.type).toBe('response_document');
    expect(part?.fallbackMarkdown).toContain('# Runtime comparison');
  });

  it('rejects unknown blocks and raw style/code fields', () => {
    expect(parseResponseDocument({
      version: 1,
      blocks: [{ type: 'iframe', src: 'https://example.com' }],
    }).ok).toBe(false);
    expect(parseResponseDocument({
      version: 1,
      blocks: [{ type: 'text', content: 'safe', sx: { display: 'none' } }],
    }).ok).toBe(false);
  });

  it('omits an unknown future block without blanking trusted siblings', () => {
    const result = parseResponseDocument({
      version: 1,
      blocks: [
        { type: 'text', content: 'Still visible' },
        { type: 'future_widget', executable: 'never' },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.blocks).toEqual([
      expect.objectContaining({ type: 'text', content: 'Still visible' }),
    ]);
  });

  it('rejects an unknown document version for Markdown fallback', () => {
    expect(parseResponseDocument({
      version: 2,
      blocks: [{ type: 'text', content: 'Future' }],
    }).ok).toBe(false);
  });

  it('accepts every trusted v1 block and one collapsible leaf layer', () => {
    const result = parseResponseDocument({
      version: 1,
      revision: 3,
      blocks: [
        { type: 'text', content: 'Narrative' },
        { type: 'heading', level: 2, text: 'Section' },
        { type: 'divider' },
        { type: 'callout', tone: 'warning', content: 'Caution' },
        { type: 'stat_grid', stats: [{ label: 'Score', value: 9 }] },
        { type: 'comparison', items: [{ title: 'A' }, { title: 'B' }] },
        { type: 'table', headers: ['A'], rows: [['B']] },
        { type: 'chart', spec: { type: 'bar', data: [{ x: 'A', y: 1 }] }, summary: 'One value' },
        { type: 'key_value', items: [{ label: 'Owner', value: 'Agent-X' }] },
        { type: 'checklist', items: [{ text: 'Validate', status: 'done' }] },
        { type: 'timeline', items: [{ title: 'Phase 1', time: 'Now' }] },
        { type: 'code', language: 'ts', code: 'const safe = true;' },
        { type: 'link_list', links: [{ label: 'Docs', href: 'https://example.com/docs' }] },
        {
          type: 'collapsible',
          title: 'Evidence',
          blocks: [{ type: 'text', content: 'Details' }],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.revision).toBe(3);
    expect(result.document.blocks).toHaveLength(14);
    const markdown = responseDocumentToMarkdown(result.document);
    expect(markdown).toContain('Owner');
    expect(markdown).toContain('[x] Validate');
    expect(markdown).toContain('Phase 1');
    expect(markdown).toContain('const safe = true;');
    expect(markdown).toContain('https://example.com/docs');
    expect(markdown).toContain('Evidence');
    expect(markdown).toContain('Details');
  });

  it('rejects unsafe links and excessive collapsible nesting', () => {
    expect(parseResponseDocument({
      version: 1,
      blocks: [{
        type: 'link_list',
        links: [{ label: 'Unsafe', href: 'javascript:alert(1)' }],
      }],
    }).ok).toBe(false);
    expect(parseResponseDocument({
      version: 1,
      blocks: [{
        type: 'collapsible',
        title: 'Outer',
        blocks: [{
          type: 'collapsible',
          title: 'Inner',
          blocks: [{ type: 'text', content: 'No' }],
        }],
      }],
    }).ok).toBe(false);
  });

  it('rejects documents above the byte limit', () => {
    const oversized = {
      version: 1,
      blocks: [{
        type: 'text',
        content: 'x'.repeat(MAX_RESPONSE_DOCUMENT_BYTES + 1),
      }],
    };
    const result = parseResponseDocument(oversized);
    expect(result).toEqual({ ok: false, error: 'response-document-too-large' });
  });
});
