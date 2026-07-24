/**
 * LidMappingStore — persistent, cross-restart lid<->phone mapping.
 *
 * WhatsApp's privacy-ID (`@lid`) feature means a message's sender may only be
 * identifiable by an opaque id, with the phone number arriving later (or
 * never) in a separate event (contact update, message key `remoteJidAlt`,
 * `lid-mapping.update`). We keep an in-memory cache for fast synchronous
 * resolution (used by `toNeutralJid()` on the hot message path) and write
 * through to `whatsapp_lid_mapping` so mappings survive restarts.
 *
 * Negative caching: a `phone === null` row means "we've seen this lid but
 * don't know its phone yet" — distinct from "never seen" (returns undefined),
 * so callers can tell "no data" apart from "known unresolved" without an
 * extra round trip.
 */
import type { Pool } from 'pg';

type PgPool = Pick<Pool, 'query'>;

interface LidMappingRow {
  lid: string;
  phone: string | null;
}

export class LidMappingStore {
  private readonly lidToPhone = new Map<string, string | null>();
  private readonly phoneToLids = new Map<string, Set<string>>();
  private loaded = false;

  constructor(private readonly pool: PgPool) {}

  /** Load all known mappings into memory. Call once at startup. */
  async load(): Promise<void> {
    const res = await this.pool.query('SELECT lid, phone FROM whatsapp_lid_mapping');
    for (const row of res.rows as LidMappingRow[]) {
      this.lidToPhone.set(row.lid, row.phone);
      if (row.phone) {
        this.indexReverse(row.lid, row.phone);
      }
    }
    this.loaded = true;
  }

  private indexReverse(lid: string, phone: string): void {
    let set = this.phoneToLids.get(phone);
    if (!set) {
      set = new Set();
      this.phoneToLids.set(phone, set);
    }
    set.add(lid);
  }

  /**
   * Synchronous read: phone number if known, `null` if known-unresolvable,
   * `undefined` if this lid has never been seen at all.
   */
  getCached(lid: string): string | null | undefined {
    return this.lidToPhone.get(lid);
  }

  /** Reverse lookup: all lids ever observed mapping to a given phone number. */
  lidsForPhone(phone: string): string[] {
    return Array.from(this.phoneToLids.get(phone) ?? []);
  }

  /**
   * Record (or update) a lid->phone mapping. Last-write-wins, since WhatsApp
   * recycles phone numbers — a mapping is "best known", not permanent truth.
   */
  async remember(lid: string, phone: string | null): Promise<void> {
    const previous = this.lidToPhone.get(lid);
    if (previous === phone) return; // no-op, avoid a pointless write

    this.lidToPhone.set(lid, phone);
    if (phone) this.indexReverse(lid, phone);

    await this.pool.query(
      `INSERT INTO whatsapp_lid_mapping (lid, phone, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (lid) DO UPDATE SET
         phone = EXCLUDED.phone,
         updated_at = NOW()`,
      [lid, phone],
    );
  }

  isLoaded(): boolean {
    return this.loaded;
  }
}
