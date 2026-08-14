import { parseWaId, phoneFromNeutralJid, toNeutralJid } from '../identity/wa-id.js';
import type { IndexedContact } from './types.js';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'from', 'to', 'of', 'and', 'or', 'my', 'me', 'for', 'in', 'on', 'at',
]);

export function normalizePersonName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s+]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function nameTokens(value: string): string[] {
  return normalizePersonName(value).split(' ').filter(Boolean);
}

export function queryTokens(value: string): string[] {
  return nameTokens(value).filter((t) => !STOP_WORDS.has(t));
}

export function splitSavedName(savedName: string | undefined): { firstName?: string; lastName?: string } {
  if (!savedName?.trim()) return {};
  const parts = savedName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export function looksLikeJid(query: string): boolean {
  return query.includes('@');
}

export function looksLikePhone(query: string): boolean {
  if (query.includes('@')) return false;
  const digits = digitsOnly(query);
  return digits.length >= 7 && digits.length <= 15;
}

export function queryToNeutralJid(query: string): string | undefined {
  const trimmed = query.trim();
  if (!trimmed) return undefined;
  if (looksLikeJid(trimmed)) {
    const neutral = toNeutralJid(trimmed);
    const parsed = parseWaId(neutral);
    if (parsed.kind === 'unknown') return undefined;
    return neutral;
  }
  if (looksLikePhone(trimmed)) {
    return `${digitsOnly(trimmed)}@c.us`;
  }
  return undefined;
}

export function contactDisplayName(c: Pick<IndexedContact, 'savedName' | 'businessName' | 'notifyName' | 'phone' | 'jid'>): string {
  return c.savedName || c.businessName || c.notifyName || c.phone || c.jid;
}

export function buildSearchText(c: Omit<IndexedContact, 'searchText' | 'updatedAt'> & { searchText?: string; updatedAt?: string }): string {
  return normalizePersonName(
    [
      c.savedName,
      c.firstName,
      c.lastName,
      c.notifyName,
      c.businessName,
      c.username,
      ...(c.aliases ?? []),
      c.phone,
      c.jid,
    ].filter(Boolean).join(' '),
  );
}

export function uniqueByJid(contacts: IndexedContact[]): IndexedContact[] {
  const seen = new Set<string>();
  const out: IndexedContact[] = [];
  for (const c of contacts) {
    if (seen.has(c.jid)) continue;
    seen.add(c.jid);
    out.push(c);
  }
  return out;
}

export function last10(digits: string): string {
  return digits.length <= 10 ? digits : digits.slice(-10);
}

export function phonesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const left = last10(a);
  const right = last10(b);
  return left.length >= 10 && right.length >= 10 && left === right;
}

export function phoneFromIndexedJid(jid: string): string | undefined {
  return phoneFromNeutralJid(toNeutralJid(jid));
}
