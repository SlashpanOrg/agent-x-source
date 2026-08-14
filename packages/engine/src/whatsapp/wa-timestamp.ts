/** Coerce Baileys / wwebjs timestamps (number, Long, string) to unix seconds. */
export function waUnixTimestamp(value: unknown, fallback = Math.floor(Date.now() / 1000)): number {
  const n = readNumericTimestamp(value);
  if (n == null) return fallback;
  // Milliseconds since 2001-09-09 are > 1e12.
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

function readNumericTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'bigint') {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (value && typeof value === 'object') {
    const rec = value as { toNumber?: () => number; low?: number; high?: number };
    if (typeof rec.toNumber === 'function') {
      try {
        const n = rec.toNumber();
        if (Number.isFinite(n) && n > 0) return n;
      } catch { /* ignore */ }
    }
  }
  return null;
}

/** Telegram-style numeric platform ids only — WhatsApp ids are alphanumeric. */
export function toNullableBigint(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
