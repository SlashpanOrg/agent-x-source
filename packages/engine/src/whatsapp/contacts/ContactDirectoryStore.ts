import type { Pool } from 'pg';
import { getLogger } from '@agentx/shared';
import type { WhatsAppContactEntry } from '../engine/IWhatsAppEngine.js';
import { phoneFromNeutralJid, toNeutralJid } from '../identity/wa-id.js';
import { formatResolveForTool } from './formatContact.js';
import { mapEngineContact, mergeIndexedContact } from './mapEngineContact.js';
import {
  buildSearchText,
  contactDisplayName,
  normalizePersonName,
  queryTokens,
  splitSavedName,
} from './normalize.js';
import { resolveContact } from './resolveContact.js';
import type { IndexedContact, ResolveResult } from './types.js';

type PgPool = Pick<Pool, 'query'>;

function rowToContact(row: Record<string, unknown>): IndexedContact {
  const aliases = Array.isArray(row['aliases'])
    ? (row['aliases'] as unknown[]).filter((a): a is string => typeof a === 'string')
    : [];
  return {
    jid: String(row['jid']),
    phone: row['phone'] ? String(row['phone']) : undefined,
    lidJid: row['lid_jid'] ? String(row['lid_jid']) : undefined,
    savedName: row['saved_name'] ? String(row['saved_name']) : undefined,
    firstName: row['first_name'] ? String(row['first_name']) : undefined,
    lastName: row['last_name'] ? String(row['last_name']) : undefined,
    notifyName: row['notify_name'] ? String(row['notify_name']) : undefined,
    businessName: row['business_name'] ? String(row['business_name']) : undefined,
    username: row['username'] ? String(row['username']) : undefined,
    isSaved: Boolean(row['is_saved']),
    sendable: row['sendable'] !== false,
    aliases,
    searchText: String(row['search_text'] ?? ''),
    updatedAt: new Date(String(row['updated_at'] ?? Date.now())).toISOString(),
  };
}

/**
 * Persistent owner address book. In-memory cache is the resolve source so
 * name → JID is exact and fast. Postgres survives restarts.
 */
export class ContactDirectoryStore {
  private readonly byJid = new Map<string, IndexedContact>();

  constructor(private readonly pool: PgPool) {}

  async load(): Promise<void> {
    try {
      const { rows } = await this.pool.query(`SELECT * FROM whatsapp_contacts`);
      this.byJid.clear();
      for (const row of rows as Record<string, unknown>[]) {
        const c = rowToContact(row);
        this.byJid.set(c.jid, c);
      }
      getLogger().info('WHATSAPP', `Contact directory loaded (${this.byJid.size} contacts)`);
    } catch (err) {
      getLogger().warn(
        'WHATSAPP',
        `Contact directory load failed: ${err instanceof Error ? err.message : String(err)} — run migrations / restart Agent-X`,
      );
    }
  }

  getByJid(jid: string): IndexedContact | undefined {
    const neutral = toNeutralJid(jid);
    return this.byJid.get(neutral) ?? this.byJid.get(jid);
  }

  all(): IndexedContact[] {
    return [...this.byJid.values()];
  }

  count(): number {
    return this.byJid.size;
  }

  resolve(query: string): ResolveResult {
    return resolveContact(query, this.all());
  }

  search(query: string | undefined, limit: number): IndexedContact[] {
    const cap = Math.max(1, Math.min(limit, 500));
    const all = this.all();
    const q = query?.trim();
    let list = all;
    if (q) {
      const norm = normalizePersonName(q);
      const toks = queryTokens(q);
      list = all.filter((c) => {
        if (c.searchText.includes(norm) || (c.phone && c.phone.includes(q.replace(/\D/g, '')))) return true;
        if (toks.length === 0) return false;
        const hay = new Set(c.searchText.split(' ').filter(Boolean));
        return toks.every((t) => hay.has(t) || [...hay].some((h) => h.startsWith(t) && t.length >= 3));
      });
    }
    list.sort((a, b) => {
      if (a.isSaved !== b.isSaved) return a.isSaved ? -1 : 1;
      return contactDisplayName(a).localeCompare(contactDisplayName(b));
    });
    return list.slice(0, cap);
  }

  async upsertFromEngine(entries: WhatsAppContactEntry[]): Promise<number> {
    const incoming: IndexedContact[] = [];
    for (const entry of entries) {
      const mapped = mapEngineContact(entry);
      if (mapped) incoming.push(mapped);
    }
    if (incoming.length === 0) return 0;
    return this.upsertMany(incoming);
  }

  async observeInbound(jid: string, notifyName?: string): Promise<void> {
    const neutral = toNeutralJid(jid);
    const existing = this.getByJid(neutral);
    const name = notifyName?.trim();
    if (existing) {
      if (name && !existing.notifyName) {
        await this.upsertMany([{ ...existing, notifyName: name, searchText: '', updatedAt: new Date().toISOString() }]);
      }
      return;
    }
    const phone = phoneFromNeutralJid(neutral);
    if (!name && !phone) return;
    await this.upsertFromEngine([{
      jid: neutral,
      phoneNumber: phone,
      notify: name,
      name,
    }]);
  }

  async rememberAlias(jid: string, alias: string): Promise<{ ok: true; contact: IndexedContact } | { ok: false; reason: string }> {
    const label = alias.trim();
    if (!label) return { ok: false, reason: 'Alias is empty.' };
    const norm = normalizePersonName(label);
    if (!norm) return { ok: false, reason: 'Alias is empty.' };

    const contact = this.getByJid(jid);
    if (!contact) return { ok: false, reason: `No indexed contact for ${jid}.` };

    const owner = this.all().find((c) => c.jid !== contact.jid && c.aliases.some((a) => normalizePersonName(a) === norm));
    if (owner) {
      return { ok: false, reason: `"${label}" is already an alias for ${contactDisplayName(owner)} (${owner.jid}).` };
    }

    const aliases = [...new Set([...contact.aliases, label])];
    const next = { ...contact, aliases, searchText: buildSearchText({ ...contact, aliases }), updatedAt: new Date().toISOString() };
    await this.persist(next);
    this.byJid.set(next.jid, next);
    return { ok: true, contact: next };
  }

  async upsertMany(contacts: IndexedContact[]): Promise<number> {
    let written = 0;
    for (const incoming of contacts) {
      const prev = this.getByJid(incoming.jid);
      const merged = mergeIndexedContact(prev, incoming);
      if (merged.searchText === '') merged.searchText = buildSearchText(merged);
      if (!merged.firstName && merged.savedName) {
        const split = splitSavedName(merged.savedName);
        merged.firstName = split.firstName;
        merged.lastName = split.lastName;
      }

      if (merged.lidJid && merged.lidJid !== merged.jid && this.byJid.has(merged.lidJid)) {
        this.byJid.delete(merged.lidJid);
        try {
          await this.pool.query(`DELETE FROM whatsapp_contacts WHERE jid = $1`, [merged.lidJid]);
        } catch { /* table may not exist yet */ }
      }

      try {
        await this.persist(merged);
        this.byJid.set(merged.jid, merged);
        written += 1;
      } catch (err) {
        getLogger().warn(
          'WHATSAPP',
          `Contact upsert failed for ${merged.jid}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return written;
  }

  async purge(): Promise<void> {
    this.byJid.clear();
    try {
      await this.pool.query(`DELETE FROM whatsapp_contacts`);
    } catch { /* ignore */ }
  }

  formatResolve(query: string) {
    return formatResolveForTool(this.resolve(query));
  }

  private async persist(c: IndexedContact): Promise<void> {
    await this.pool.query(
      `INSERT INTO whatsapp_contacts (
         jid, phone, lid_jid, saved_name, first_name, last_name,
         notify_name, business_name, username, is_saved, sendable,
         aliases, search_text, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
       ON CONFLICT (jid) DO UPDATE SET
         phone = COALESCE(EXCLUDED.phone, whatsapp_contacts.phone),
         lid_jid = COALESCE(EXCLUDED.lid_jid, whatsapp_contacts.lid_jid),
         saved_name = COALESCE(EXCLUDED.saved_name, whatsapp_contacts.saved_name),
         first_name = COALESCE(EXCLUDED.first_name, whatsapp_contacts.first_name),
         last_name = COALESCE(EXCLUDED.last_name, whatsapp_contacts.last_name),
         notify_name = COALESCE(EXCLUDED.notify_name, whatsapp_contacts.notify_name),
         business_name = COALESCE(EXCLUDED.business_name, whatsapp_contacts.business_name),
         username = COALESCE(EXCLUDED.username, whatsapp_contacts.username),
         is_saved = EXCLUDED.is_saved OR whatsapp_contacts.is_saved,
         sendable = EXCLUDED.sendable OR whatsapp_contacts.sendable,
         aliases = EXCLUDED.aliases,
         search_text = EXCLUDED.search_text,
         updated_at = NOW()`,
      [
        c.jid,
        c.phone ?? null,
        c.lidJid ?? null,
        c.savedName ?? null,
        c.firstName ?? null,
        c.lastName ?? null,
        c.notifyName ?? null,
        c.businessName ?? null,
        c.username ?? null,
        c.isSaved,
        c.sendable,
        c.aliases,
        c.searchText,
      ],
    );
  }
}
