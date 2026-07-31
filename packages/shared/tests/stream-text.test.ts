import { describe, it, expect } from 'vitest';
import { appendStreamText, repairStreamTextGlitches } from '../src/utils/stream-text.js';

describe('appendStreamText', () => {
  it('appends normal incremental deltas', () => {
    expect(appendStreamText('The', ' problem')).toBe('The problem');
  });

  it('handles cumulative snapshot chunks', () => {
    expect(appendStreamText('Now', 'Now try running the backend')).toBe('Now try running the backend');
  });

  it('handles TheThe-style cumulative duplication', () => {
    expect(appendStreamText('The', 'The problem is')).toBe('The problem is');
  });

  it('ignores duplicate delta re-send', () => {
    expect(appendStreamText('Hello', 'Hello')).toBe('Hello');
    expect(appendStreamText('Hello world', 'world')).toBe('Hello world');
  });

  it('handles overlap at boundary', () => {
    expect(appendStreamText('abcde', 'cdefg')).toBe('abcdefg');
  });

  it('does not strip short coincidental overlap (1-2 chars)', () => {
    // Pure delta "0,000/-" after "Rs. 45,0" — the "0" is NOT an overlap.
    expect(appendStreamText('Rs. 45,0', '0,000/-')).toBe('Rs. 45,00,000/-');
    expect(appendStreamText('Rs. 1,0', '0,000/-')).toBe('Rs. 1,00,000/-');
    // 2-char coincidental match
    expect(appendStreamText('code', 'def is clean')).toBe('codedef is clean');
  });
});

describe('repairStreamTextGlitches', () => {
  it('fixes leading doubled token', () => {
    expect(repairStreamTextGlitches('TheThe problem is here')).toBe('The problem is here');
    expect(repairStreamTextGlitches('NowNow try running')).toBe('Now try running');
  });

  it('fixes glued and spaced duplex tokens from reasoning persist bug', () => {
    // Numeric doubles (500500) are intentionally NOT repaired — see JSDoc.
    expect(repairStreamTextGlitches('HTTPHTTP  500500 means means Next Next.js.js')).toBe(
      'HTTP 500500 means Next.js',
    );
    expect(repairStreamTextGlitches('pnpm is is available available')).toBe('pnpm is available');
  });

  it('removes trailing duplicate clause', () => {
    const bad =
      'The problem is that the imports are relative: problem is that the imports are relative';
    const fixed = repairStreamTextGlitches(bad);
    expect(fixed).toBe('The problem is that the imports are relative');
  });

  it('never modifies numbers — no heuristic can distinguish valid numbers from glitches', () => {
    // Indian formatting
    expect(repairStreamTextGlitches('Rs. 5,00,000/-')).toBe('Rs. 5,00,000/-');
    expect(repairStreamTextGlitches('Rs. 45,00,000/-')).toBe('Rs. 45,00,000/-');
    // European formatting
    expect(repairStreamTextGlitches('€5.000,00')).toBe('€5.000,00');
    // Space-separated
    expect(repairStreamTextGlitches('Rs. 5 00 000')).toBe('Rs. 5 00 000');
    // Plain numbers that look "doubled" but may be legitimate
    expect(repairStreamTextGlitches('500500')).toBe('500500');
    expect(repairStreamTextGlitches('123123')).toBe('123123');
    expect(repairStreamTextGlitches('value is 999999 here')).toBe('value is 999999 here');
    // Multiple values in a table row
    expect(repairStreamTextGlitches('EMD: Rs. 45,00,000/- | Deposit: Rs. 1,00,000/-')).toBe(
      'EMD: Rs. 45,00,000/- | Deposit: Rs. 1,00,000/-',
    );
  });
});
