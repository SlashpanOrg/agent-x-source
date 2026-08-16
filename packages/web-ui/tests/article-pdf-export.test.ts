import { describe, expect, it } from 'vitest';
import { buildPrintHtml, colorTokensToHtml, renderArticleContentToVectorPdf } from '../src/articles';

describe('print template', () => {
  it('keeps table rows and paragraphs together across page breaks', () => {
    const html = buildPrintHtml('# Title\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n', 'Title');
    expect(html).toContain('page-break-inside: avoid');
    expect(html).toContain('orphans: 3');
    expect(html).toContain('widows: 3');
    expect(html).toContain('thead {\n    display: table-header-group');
    expect(html).not.toContain('.print-root div {\n    break-inside: avoid');
    expect(html).toContain('@page');
    expect(html).toContain('margin: 16mm');
    expect(html).toContain('<table>');
    expect(html).toContain('<thead>');
    expect(html).toContain('ax-article');
  });

  it('converts color spans into print HTML instead of escaped tags', () => {
    const html = buildPrintHtml('Glucose is <span style="color:red">335 mg/dL</span>.', 'Labs');
    expect(html).toContain('style="color:#ef5350');
    expect(html).toContain('335 mg/dL');
    expect(html).not.toContain('&lt;span');
    expect(html).not.toContain('⟦axc:');
  });

  it('colorTokensToHtml maps internal tokens to spans', () => {
    expect(colorTokensToHtml('⟦axc:#66bb6a⟧Normal⟦/axc⟧')).toContain('color:#66bb6a');
  });
});

describe('vector article PDF', () => {
  it('emits a compact text PDF, not a raster image wrapper', async () => {
    const rows = Array.from({ length: 80 }, (_, i) => `| Test ${i} | < 1.2 mg/dL | 1.2 mg/dL | At upper limit |`);
    const content = [
      '# Liver function',
      '',
      'These tables compare each result with the **reference ranges** printed by the laboratory.',
      '',
      '| TEST | REQUIRED/REFERENCE | ACTUAL RESULT | DIFFERENCE/STATUS |',
      '| --- | --- | --- | --- |',
      ...rows,
    ].join('\n');

    const blob = await renderArticleContentToVectorPdf(content, 'Liver function');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const head = String.fromCharCode(...bytes.slice(0, 5));
    expect(head).toBe('%PDF-');
    expect(blob.size).toBeGreaterThan(1000);
    expect(blob.size).toBeLessThan(400_000);
    const sample = String.fromCharCode(...bytes.slice(0, Math.min(bytes.length, 8000)));
    expect(sample).toMatch(/\/Type\s*\/Font|\/BaseFont/);
  });
});
