import { describe, it, expect } from 'vitest';
import { extractArticleFromLegacyTsx, normalizeArticleInput } from '../src/utils/article-input.js';

describe('extractArticleFromLegacyTsx', () => {
  it('extracts JSON-stringified markdown from auto-wrapped shell', () => {
    const md = '# Report\n\n- item one\n- item two';
    const tsx = `import { CanvasRoot, Section, Markdown } from '@agentx/canvas';
export default function SavedCanvas() {
  return (
    <CanvasRoot>
      <Section title="Report">
        <Markdown>${JSON.stringify(md)}</Markdown>
      </Section>
    </CanvasRoot>
  );
}`;
    expect(extractArticleFromLegacyTsx(tsx)).toBe(md);
  });

  it('extracts template literal markdown', () => {
    const tsx = '<Markdown>{`## Notes\\n\\nHello`}</Markdown>';
    expect(extractArticleFromLegacyTsx(tsx)).toBe('## Notes\n\nHello');
  });
});

describe('normalizeArticleInput', () => {
  it('prefers explicit content and strips agent monologue', () => {
    const raw = `Let me gather the data.

## Hello

World`;
    expect(normalizeArticleInput({ content: raw })).toBe('## Hello\n\nWorld');
  });

  it('wraps unknown TSX as fenced source', () => {
    const tsx = 'export default function X() { return null; }';
    const out = normalizeArticleInput({ contentTsx: tsx, title: 'Ops' });
    expect(out).toContain('# Ops');
    expect(out).toContain('```tsx');
    expect(out).toContain(tsx);
  });

  it('keeps a table header when the derived title matches the header row', () => {
    const table = `| Test | Result |\n| --- | --- |\n| Glucose | 335 |`;
    const out = normalizeArticleInput({
      title: '| Test | Result |',
      content: table,
    });
    expect(out).toContain('| Test |');
    expect(out).toContain('Glucose');
  });
});
