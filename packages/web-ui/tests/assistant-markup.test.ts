import { describe, expect, it } from 'vitest';
import {
  isRefFileHref,
  prepareAssistantMarkup,
  refFileNameFromHref,
  resolveColor,
  splitColoredMarkup,
} from '../src/chat/assistant-markup';

describe('prepareAssistantMarkup', () => {
  it('converts any colored HTML tag, not only one span shape', () => {
    const prepared = prepareAssistantMarkup(
      'Glucose is <span style="color:red">335 mg/dL</span> and <font color="green">Nil</font>.',
    );
    expect(prepared).toContain('⟦axc:#ef5350⟧335 mg/dL⟦/axc⟧');
    expect(prepared).toContain('⟦axc:#66bb6a⟧Nil⟦/axc⟧');
    expect(prepared).not.toContain('<span');
    expect(prepared).not.toContain('<font');
  });

  it('handles GFM table cells including a leading > inside the value', () => {
    const row = '| Fasting | 70–100 mg/dL | <span style="color:red">335 mg/dL</span> | <span style="color:red">>235 mg/dL high</span> |';
    const prepared = prepareAssistantMarkup(row);
    expect(prepared).toContain('⟦axc:#ef5350⟧335 mg/dL⟦/axc⟧');
    expect(prepared).toContain('⟦axc:#ef5350⟧>235 mg/dL high⟦/axc⟧');
    expect(prepared).not.toContain('<span');
  });

  it('decodes entity-escaped quotes and tags from stored markdown', () => {
    const prepared = prepareAssistantMarkup(
      'Colour key: &lt;span style=&quot;color:green&quot;&gt;Normal&lt;/span&gt;',
    );
    expect(prepared).toBe('Colour key: ⟦axc:#66bb6a⟧Normal⟦/axc⟧');
  });

  it('strips unknown tags and keeps inner text', () => {
    expect(prepareAssistantMarkup('<span style="color:magenta">x</span>')).toBe('x');
    expect(prepareAssistantMarkup('<div>plain</div>')).toBe('plain');
  });

  it('is idempotent and leaves fenced code alone', () => {
    const html = '<span style="color:blue">133</span>';
    const once = prepareAssistantMarkup(html);
    expect(prepareAssistantMarkup(once)).toBe(once);
    const fenced = '```\n<span style="color:red">raw</span>\n```';
    expect(prepareAssistantMarkup(fenced)).toContain('<span style="color:red">raw</span>');
  });

  it('turns ref_file and ref_snippet tags into markdown chips', () => {
    const prepared = prepareAssistantMarkup(
      'See <ref_file file="/tmp/TVMOL08551127_ResultPrint_29535105.pdf" /> and <ref_snippet file="notes.md" lines="12-18" />',
    );
    expect(prepared).toContain('[TVMOL08551127_ResultPrint_29535105.pdf](ax-ref-file:');
    expect(prepared).toContain('[notes.md:12-18](ax-ref-snippet:');
    expect(prepared).not.toContain('<ref_file');
    expect(isRefFileHref('ax-ref-file:%2Ftmp%2Freport.pdf')).toBe(true);
    expect(refFileNameFromHref('ax-ref-file:%2Ftmp%2Freport.pdf')).toBe('report.pdf');
  });

  it('maps named, hex, and rgb colors onto the same palette', () => {
    expect(resolveColor('red')).toBe('#ef5350');
    expect(resolveColor('#4caf50')).toBe('#4caf50');
    expect(resolveColor('rgb(66, 165, 245)')).toBe('#42a5f5');
  });

  it('splits tokens for the shared renderer', () => {
    expect(splitColoredMarkup('Glucose is ⟦axc:#ef5350⟧335 mg/dL⟦/axc⟧ today.')).toEqual([
      { kind: 'text', text: 'Glucose is ' },
      { kind: 'color', color: '#ef5350', text: '335 mg/dL' },
      { kind: 'text', text: ' today.' },
    ]);
  });
});
