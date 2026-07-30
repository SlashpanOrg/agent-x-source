import { describe, it, expect } from 'vitest';
import { buildRagContext } from '../src/prompt/PromptEngine.js';

describe('buildRagContext', () => {
  it('returns empty string for empty results', () => {
    expect(buildRagContext([])).toBe('');
  });

  it('formats RAG results with source labels', () => {
    const result = buildRagContext([
      { content: 'Hello world', metadata: { sourceName: 'doc1.md' } },
    ]);
    expect(result).toContain('[doc1.md]');
    expect(result).toContain('Hello world');
    expect(result).toContain('[RELEVANT_DOCUMENTS]');
  });

  it('truncates long content', () => {
    const longContent = 'A'.repeat(3000);
    const result = buildRagContext([{ content: longContent }]);
    expect(result).toContain('…');
    expect(result.length).toBeLessThan(longContent.length + 200);
  });

  it('includes page numbers when available', () => {
    const result = buildRagContext([
      { content: 'Page content', metadata: { sourceName: 'report.pdf', pageNumber: 42 } },
    ]);
    expect(result).toContain('p.42');
  });
});
