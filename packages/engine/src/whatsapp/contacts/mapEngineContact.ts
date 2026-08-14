import { parseWaId, phoneFromNeutralJid, toNeutralJid } from '../identity/wa-id.js';
import type { WhatsAppContactEntry } from '../engine/IWhatsAppEngine.js';
import { buildSearchText, digitsOnly, splitSavedName } from './normalize.js';
import type { IndexedContact } from './types.js';

function phoneFromEngineEntry(entry: WhatsAppContactEntry, neutralJid: string): string | undefined {
  const fromNeutral = phoneFromNeutralJid(neutralJid);
  if (fromNeutral) return fromNeutral;
  const raw = entry.phoneNumber?.trim();
  if (!raw) return undefined;
  if (raw.includes('@')) {
    return phoneFromNeutralJid(toNeutralJid(raw)) ?? (digitsOnly(raw) || undefined);
  }
  const digits = digitsOnly(raw);
  return digits.length >= 7 ? digits : undefined;
}

export function mapEngineContact(entry: WhatsAppContactEntry): IndexedContact | null {
  const rawJid = (entry.rawJid ?? entry.jid).trim();
  if (!rawJid) return null;
  const parsedRaw = parseWaId(rawJid);
  if (parsedRaw.kind === 'group' || parsedRaw.kind === 'status' || parsedRaw.kind === 'broadcast' || parsedRaw.kind === 'newsletter') {
    return null;
  }

  const jid = toNeutralJid(entry.jid || rawJid);
  const parsed = parseWaId(jid);
  if (parsed.kind !== 'user' && parsed.kind !== 'lid') return null;

  const savedName = entry.savedName?.trim() || undefined;
  const notifyName = entry.notify?.trim() || undefined;
  const businessName = entry.businessName?.trim() || undefined;
  const username = entry.username?.trim() || undefined;
  const phone = phoneFromEngineEntry(entry, jid);
  if (!savedName && !notifyName && !businessName && !username && !phone) return null;

  const split = splitSavedName(savedName);
  const sendable = parsed.kind === 'user';
  const lidJid = parsedRaw.kind === 'lid' ? `${parsedRaw.id}@lid` : undefined;

  const contact: IndexedContact = {
    jid,
    phone,
    lidJid,
    savedName,
    firstName: split.firstName,
    lastName: split.lastName,
    notifyName,
    businessName,
    username,
    isSaved: Boolean(savedName),
    sendable,
    aliases: [],
    searchText: '',
    updatedAt: new Date().toISOString(),
  };
  contact.searchText = buildSearchText(contact);
  return contact;
}

export function mergeIndexedContact(prev: IndexedContact | undefined, incoming: IndexedContact): IndexedContact {
  if (!prev) return incoming;
  const savedName = incoming.savedName ?? prev.savedName;
  const split = splitSavedName(savedName);
  const aliases = [...new Set([...prev.aliases, ...incoming.aliases].map((a) => a.trim()).filter(Boolean))];
  const merged: IndexedContact = {
    ...prev,
    jid: incoming.sendable || !prev.sendable ? incoming.jid : prev.jid,
    phone: incoming.phone ?? prev.phone,
    lidJid: incoming.lidJid ?? prev.lidJid,
    savedName,
    firstName: split.firstName ?? incoming.firstName ?? prev.firstName,
    lastName: split.lastName ?? incoming.lastName ?? prev.lastName,
    notifyName: incoming.notifyName ?? prev.notifyName,
    businessName: incoming.businessName ?? prev.businessName,
    username: incoming.username ?? prev.username,
    isSaved: incoming.isSaved || prev.isSaved,
    sendable: incoming.sendable || prev.sendable,
    aliases,
    searchText: '',
    updatedAt: incoming.updatedAt || prev.updatedAt,
  };
  merged.searchText = buildSearchText(merged);
  return merged;
}
