import { describe, it, expect } from 'vitest';
import { deriveArticleTitle, isGenericArticleTitle } from '../src/utils/article-title.js';

describe('deriveArticleTitle', () => {
  it('prefers explicit non-generic title', () => {
    expect(deriveArticleTitle({ title: 'Q3 Revenue Dashboard' })).toBe('Q3 Revenue Dashboard');
  });

  it('ignores generic explicit titles and derives from TSX Section', () => {
    const tsx = `import { CanvasRoot, Section } from '@agentx/canvas';
export default function SavedCanvas() {
  return <CanvasRoot><Section title="API Error Audit">...</Section></CanvasRoot>;
}`;
    expect(deriveArticleTitle({ title: 'Canvas', contentTsx: tsx })).toBe('API Error Audit');
  });

  it('derives from component name when section title missing', () => {
    const tsx = `export default function OpsDashboard() { return null; }`;
    expect(deriveArticleTitle({ contentTsx: tsx })).toBe('Ops Dashboard');
  });

  it('derives from article heading', () => {
    expect(deriveArticleTitle({
      content: '# Incident postmortem\n\nDetails here.',
    })).toBe('Incident postmortem');
  });

  it('derives from chart fence title', () => {
    const md = '```chart\n{"v":1,"type":"bar","title":"Errors by service","data":[]}\n```';
    expect(deriveArticleTitle({ content: md })).toBe('Errors by service');
  });

  it('uses first sentence when no heading', () => {
    expect(deriveArticleTitle({
      content: 'Latency increased across all regions during the outage window.',
    })).toBe('Latency increased across all regions during the outage window.');
  });

  it('does not steal a GFM table header as the document title', () => {
    const content = `| Test | Required/reference range | Actual result | Difference/status |
| --- | ---: | ---: | --- |
| FASTING BLOOD GLUCOSE | 70–100 mg/dL | 335 mg/dL | High |`;
    const title = deriveArticleTitle({ content });
    expect(title).not.toContain('|');
    expect(title).toContain('Test');
    expect(title).toContain('Actual result');
  });

  it('prefers a real heading over a following table', () => {
    expect(deriveArticleTitle({
      content: '# Lab report\n\n| Test | Result |\n| --- | --- |\n| Glucose | 335 |',
    })).toBe('Lab report');
  });
});

describe('isGenericArticleTitle', () => {
  it('flags generic titles', () => {
    expect(isGenericArticleTitle('Saved message')).toBe(true);
    expect(isGenericArticleTitle('Q1 Ops Review')).toBe(false);
  });
});
