import { createHash } from 'node:crypto';

/**
 * Phone-number privacy helpers for the Host/VOIP call domain.
 * Never persist a raw E.164 number to logs, events, or the call session
 * store — always redact for display and hash for equality checks.
 */

/** Strip everything except a leading `+` and digits. */
export function normalizeE164(e164: string | null | undefined): string {
  if (!e164) return '';
  const trimmed = e164.trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  return `${plus}${trimmed.replace(/[^\d]/g, '')}`;
}

/** `+1415***1234` style redaction — keeps country/area context, hides the rest. */
export function redactE164(e164: string | null | undefined): string {
  const normalized = normalizeE164(e164);
  const digits = normalized.replace(/^\+/, '');
  if (digits.length < 4) return '***';
  const last4 = digits.slice(-4);
  const prefixLen = Math.min(Math.max(digits.length - 4, 0), 3);
  const prefix = digits.slice(0, prefixLen);
  return `${normalized.startsWith('+') ? '+' : ''}${prefix}***${last4}`;
}

/** Stable, non-reversible identity for consent/opt-out/dedupe lookups. */
export function hashE164(e164: string | null | undefined): string {
  return createHash('sha256').update(normalizeE164(e164)).digest('hex');
}
