import { describe, expect, it } from 'vitest';
import {
  compileRichResponseDocument,
  responseDocumentSemanticParity,
  shouldCompileRichResponse,
} from '../src/utils/rich-response-compiler.js';

describe('rich-response compiler', () => {
  it('keeps short conversational answers in Markdown', () => {
    expect(shouldCompileRichResponse({ content: 'Done — the setting is updated.' })).toEqual({
      selected: false,
      reason: 'plain-answer',
    });
  });

  it('compiles an analytical report without an LLM or tools', () => {
    const content = `# Platform impact

> **Verdict** Proceed with the compatibility foundation first.

**24%** — Benefit impact
**8%** — Regression risk

## Module split

| Module | Gain | Risk |
| --- | --- | --- |
| Persistence | High | Low |
| Voice | Medium | Medium |

## Release gates

- [x] Schema validated
- [ ] Visual acceptance`;

    const result = compileRichResponseDocument({ content, category: 'analysis' });
    expect(result.selected).toBe(true);
    if (!result.selected) return;
    expect(result.document.title).toBe('Platform impact');
    expect(result.document.blocks.some((block) => block.type === 'callout')).toBe(true);
    expect(result.document.blocks.some((block) => block.type === 'stat_grid')).toBe(true);
    expect(result.document.blocks.some((block) => block.type === 'table')).toBe(true);
    expect(result.document.blocks.some((block) => block.type === 'checklist')).toBe(true);
    expect(result.parity).toBeGreaterThanOrEqual(0.86);
    expect(result.fallbackMarkdown).toBe(content);
  });

  it('maps code fences to trusted code blocks', () => {
    const content = `# Deployment report

## Configuration

\`\`\`json
{"enabled":true}
\`\`\`

## Notes

The configuration remains reversible and safe to disable.`;
    const result = compileRichResponseDocument({ content });
    expect(result.selected).toBe(true);
    if (!result.selected) return;
    expect(result.document.blocks.some((block) => block.type === 'code')).toBe(true);
  });

  it('measures semantic parity independently of Markdown punctuation', () => {
    const parity = responseDocumentSemanticParity(
      'Benefit impact is 24 percent and risk is low.',
      '## Benefit impact\n\n24 percent; risk: low',
    );
    expect(parity).toBe(1);
  });
});
