import { describe, expect, it } from 'vitest';
import { compileArticle, buildPrintHtml } from '../src/articles';

const PIPE_TITLE = '| Test | Required/reference range | Actual result | Difference/status';
const BROKEN_BODY = `||---|---:|---:|---|
| FASTING BLOOD GLUCOSE | 70–100 mg/dL | <span style="color:red">335 MG/DL</span> | 235 MG/DL HIGH |
| 2-hour post-meal glucose | 140 mg/dL | 470 mg/dL | High |
| HbA1c | < 5.7% | 11.9% | High |
| Urine glucose | Negative | **** | High |`;

describe('compileArticle', () => {
  it('recovers a stolen table header and compiles a real table', () => {
    const article = compileArticle({ content: BROKEN_BODY, title: PIPE_TITLE });
    expect(article.title).toBe('Test · Required/reference range · Actual result · Difference/status');
    expect(article.title).not.toContain('|');
    const table = article.blocks.find((block) => block.type === 'table');
    expect(table?.type).toBe('table');
    if (table?.type !== 'table') throw new Error('expected table');
    expect(table.headers[0]).toMatch(/Test/i);
    expect(table.headers).toHaveLength(4);
    expect(table.rows[0]?.[0]).toContain('FASTING BLOOD GLUCOSE');
    expect(table.rows).toHaveLength(4);
    expect(article.blocks.some((block) => block.type === 'paragraph' && block.text.includes('---'))).toBe(false);
  });

  it('keeps a valid heading-plus-table document', () => {
    const article = compileArticle({
      content: '# Liver function\n\n| TEST | RESULT |\n| --- | --- |\n| ALT | 40 |',
      title: 'Liver function',
    });
    expect(article.blocks.some((block) => block.type === 'table')).toBe(true);
    expect(article.blocks.filter((block) => block.type === 'heading')).toHaveLength(0);
  });
});

describe('print HTML from article engine', () => {
  it('prints recovered tables as HTML thead/tbody, not leaked pipes', () => {
    const html = buildPrintHtml(BROKEN_BODY, PIPE_TITLE, {
      createdAt: '2026-08-15T13:23:13.000Z',
      sessionId: 'session-18761174',
    });
    expect(html).toContain('<table>');
    expect(html).toContain('<thead>');
    expect(html).toContain('FASTING BLOOD GLUCOSE');
    expect(html).toContain('ax-masthead');
    expect(html).toContain('Test · Required/reference range');
    expect(html).not.toContain('||---|');
    expect(html).not.toContain('| Test | Required');
    expect(html).toContain('color:#ef5350');
  });
});
