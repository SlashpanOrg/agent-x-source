import { parseWaId } from '../identity/wa-id.js';
import {
  contactDisplayName,
  looksLikeJid,
  looksLikePhone,
  nameTokens,
  normalizePersonName,
  phonesMatch,
  queryToNeutralJid,
  queryTokens,
  uniqueByJid,
} from './normalize.js';
import type { IndexedContact, ResolveResult } from './types.js';

function syntheticFromJid(jid: string): IndexedContact {
  const parsed = parseWaId(jid);
  const phone = parsed.kind === 'user' ? parsed.id : undefined;
  const sendable = parsed.kind === 'user' || parsed.kind === 'group';
  return {
    jid,
    phone,
    isSaved: false,
    sendable,
    aliases: [],
    searchText: [phone, jid].filter(Boolean).join(' '),
    updatedAt: new Date().toISOString(),
  };
}

function exactField(value: string | undefined): string {
  return value ? normalizePersonName(value) : '';
}

function equalityHits(contacts: readonly IndexedContact[], normQuery: string): IndexedContact[] {
  const hits: IndexedContact[] = [];
  for (const c of contacts) {
    const full = [c.firstName, c.lastName].filter(Boolean).join(' ');
    const fields = [
      exactField(c.savedName),
      exactField(c.businessName),
      exactField(c.notifyName),
      exactField(c.username),
      exactField(c.firstName),
      exactField(c.lastName),
      exactField(full),
      exactField(contactDisplayName(c)),
      ...c.aliases.map((a) => exactField(a)),
    ];
    if (fields.includes(normQuery)) hits.push(c);
  }
  return uniqueByJid(hits);
}

function phoneHits(contacts: readonly IndexedContact[], digits: string): IndexedContact[] {
  const exact = contacts.filter((c) => c.phone && c.phone === digits);
  if (exact.length > 0) return uniqueByJid(exact);
  return uniqueByJid(contacts.filter((c) => c.phone && phonesMatch(c.phone, digits)));
}

function tokensMatch(queryToks: string[], contactToks: string[]): boolean {
  const remaining = [...contactToks];
  for (const q of queryToks) {
    let idx = remaining.findIndex((t) => t === q);
    if (idx === -1 && q.length === 1) {
      idx = remaining.findIndex((t) => t.startsWith(q) && t.length > 1 && !queryToks.includes(t));
    }
    if (idx === -1) return false;
    remaining.splice(idx, 1);
  }
  return true;
}

function contactNameTokens(c: IndexedContact): string[] {
  return nameTokens(
    [c.savedName, c.firstName, c.lastName, c.notifyName, c.businessName, c.username, ...c.aliases]
      .filter(Boolean)
      .join(' '),
  );
}

function finishUnique(contact: IndexedContact, reason: string): ResolveResult {
  return { status: 'unique', contact, reason };
}

function finishAmbiguous(query: string, candidates: IndexedContact[], reason: string): ResolveResult {
  return { status: 'ambiguous', query, candidates, reason };
}

/**
 * Deterministic name/phone/JID → contact. Never ranks a "best guess":
 * unique match, ask which one, or none.
 */
export function resolveContact(query: string, contacts: readonly IndexedContact[]): ResolveResult {
  const raw = query.trim();
  if (!raw) return { status: 'none', query };

  const asJid = queryToNeutralJid(raw);
  if (asJid) {
    const byJid = contacts.filter((c) => c.jid === asJid);
    if (byJid.length === 1) return finishUnique(byJid[0]!, 'jid');
    if (byJid.length > 1) return finishAmbiguous(raw, byJid, 'duplicate jid rows');

    if (looksLikePhone(raw) || (looksLikeJid(raw) && parseWaId(asJid).kind === 'user')) {
      const phone = (asJid.split('@')[0] ?? '').replace(/\D/g, '');
      const byPhone = phoneHits(contacts, phone);
      if (byPhone.length === 1) return finishUnique(byPhone[0]!, 'phone');
      if (byPhone.length > 1) return finishAmbiguous(raw, byPhone, 'multiple contacts share this number');
    }

    // Unsaved number / group / channel — still a precise target.
    return finishUnique(syntheticFromJid(asJid), 'literal-jid');
  }

  const norm = normalizePersonName(raw);
  if (!norm) return { status: 'none', query: raw };

  const named = equalityHits(contacts, norm);
  if (named.length === 1) return finishUnique(named[0]!, 'exact-name');
  if (named.length > 1) return finishAmbiguous(raw, named, 'more than one contact has this name');

  const qToks = queryTokens(raw);
  if (qToks.length === 0) return { status: 'none', query: raw };
  if (qToks.length === 1 && (qToks[0]?.length ?? 0) < 2) return { status: 'none', query: raw };

  const tokenHits = uniqueByJid(contacts.filter((c) => tokensMatch(qToks, contactNameTokens(c))));
  if (tokenHits.length === 1) return finishUnique(tokenHits[0]!, 'tokens');
  if (tokenHits.length > 1) return finishAmbiguous(raw, tokenHits, 'name matches more than one contact');

  return { status: 'none', query: raw };
}
