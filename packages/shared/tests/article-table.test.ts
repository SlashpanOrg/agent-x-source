import { describe, expect, it } from 'vitest';
import {
  deriveArticleExcerpt,
  displayArticleTitle,
  humanizeArticleExcerpt,
  recoverArticleTableHeader,
} from '../src/utils/article-table.js';

const PIPE_TITLE = '| Test | Required/reference range | Actual result | Difference/status';
const BROKEN_BODY = `||---|---:|---:|---|
| FASTING BLOOD GLUCOSE | 70–100 mg/dL | <span style="color:red">335 MG/DL</span> | 235 MG/DL HIGH |
| 2-hour post-meal glucose | 140 mg/dL | 470 mg/dL | 330 mg/dL high |`;

describe('displayArticleTitle', () => {
  it('joins pipe-row titles without markdown syntax', () => {
    expect(displayArticleTitle(PIPE_TITLE)).toBe(
      'Test · Required/reference range · Actual result · Difference/status',
    );
  });
});

describe('recoverArticleTableHeader', () => {
  it('restores a stolen GFM header from the document title', () => {
    const recovered = recoverArticleTableHeader(BROKEN_BODY, PIPE_TITLE);
    const lines = recovered.trim().split('\n');
    expect(lines[0]).toMatch(/^\| Test \|/);
    expect(lines[1]).toMatch(/^\| ---/);
    expect(lines[2]).toContain('FASTING BLOOD GLUCOSE');
    expect(recovered).not.toContain('||---|');
  });

  it('is a no-op when the table is already valid', () => {
    const valid = `| A | B |\n| --- | --- |\n| 1 | 2 |`;
    expect(recoverArticleTableHeader(valid, 'A · B')).toBe(valid);
  });
});

describe('excerpts', () => {
  it('does not preview raw GFM separators', () => {
    const excerpt = deriveArticleExcerpt(BROKEN_BODY);
    expect(excerpt).not.toMatch(/---/);
    expect(excerpt).toContain('FASTING BLOOD GLUCOSE');
  });

  it('humanizes stored pipe excerpts', () => {
    expect(humanizeArticleExcerpt('| Test | Range | ||---|---|')).toContain('Test');
    expect(humanizeArticleExcerpt('| Test | Range | ||---|---|')).not.toContain('|');
  });
});
