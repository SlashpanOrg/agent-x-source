import { describe, expect, it } from 'vitest';
import { toNullableBigint, waUnixTimestamp } from '../src/whatsapp/wa-timestamp.js';

describe('waUnixTimestamp', () => {
  it('keeps unix seconds', () => {
    expect(waUnixTimestamp(1_700_000_000)).toBe(1_700_000_000);
  });

  it('converts millisecond timestamps', () => {
    expect(waUnixTimestamp(1_700_000_000_000)).toBe(1_700_000_000);
  });

  it('reads Baileys Long objects via toNumber', () => {
    expect(waUnixTimestamp({ toNumber: () => 1_700_000_050 })).toBe(1_700_000_050);
  });

  it('falls back instead of returning NaN', () => {
    const before = Math.floor(Date.now() / 1000);
    const n = waUnixTimestamp({ toNumber: () => Number.NaN });
    expect(Number.isFinite(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(before);
  });
});

describe('toNullableBigint', () => {
  it('accepts numeric telegram-style ids', () => {
    expect(toNullableBigint('123456789')).toBe(123456789);
    expect(toNullableBigint(99)).toBe(99);
  });

  it('rejects WhatsApp alphanumeric ids so they never become NaN', () => {
    expect(toNullableBigint('3EB0ABCDEF')).toBeNull();
    expect(toNullableBigint('15551234567@c.us')).toBeNull();
    expect(toNullableBigint(Number.NaN)).toBeNull();
  });
});
