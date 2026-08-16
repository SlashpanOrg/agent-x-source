import { describe, expect, it } from 'vitest';
import { assistantTextsOverlap, displayContent } from '../src/chat/utils';

describe('assistantTextsOverlap', () => {
  it('detects exact and prefix duplicates', () => {
    const body = 'Yes, but with one catch that decides whether you actually win.';
    expect(assistantTextsOverlap(body, body)).toBe(true);
    expect(assistantTextsOverlap(body, body.slice(0, 40))).toBe(true);
    expect(assistantTextsOverlap(body.slice(0, 40), body)).toBe(true);
  });

  it('rejects unrelated replies', () => {
    expect(assistantTextsOverlap(
      'Yes, but with one catch that decides whether you actually win.',
      'Here is a completely different answer about weather instead.',
    )).toBe(false);
  });

  it('displayContent collapses overlapping text parts when content is empty', () => {
    const report = '## Overall assessment\n\nBoth reports show elevated glucose and lipids.';
    expect(displayContent({
      content: '',
      parts: [
        { type: 'text', content: report.slice(0, 48) },
        { type: 'text', content: report },
      ],
    })).toBe(report);
  });
});
