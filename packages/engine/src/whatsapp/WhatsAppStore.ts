/**
 * WhatsAppStore — encrypted persistence for the single WhatsApp session's
 * Baileys authentication material.
 *
 * Baileys' `AuthenticationState` splits into two independently-shaped parts
 * (see @whiskeysockets/baileys `Types/Auth.d.ts`):
 *   - `creds`: one `AuthenticationCreds` object (noise/identity/signed-prekey
 *     material, registration id, account info). Changes occasionally.
 *   - `keys`: a `SignalKeyStore` accessed via get(category, ids) / set(data),
 *     mutated frequently — one row read/write per key, never a full-blob
 *     rewrite, so a busy chat doesn't force us to re-encrypt/re-persist an
 *     ever-growing JSON document on every message.
 *
 * Both `creds` and individual key values may contain `Buffer`/`Uint8Array`
 * fields, which `JSON.stringify`/`JSON.parse` don't round-trip correctly on
 * their own. Baileys exports `BufferJSON.replacer`/`reviver` specifically for
 * this (the same utility `useMultiFileAuthState` uses internally for its
 * filesystem-backed store) — we reuse it here for our Postgres-backed store,
 * which is exactly the kind of "documented extension point" substitution the
 * implementation plan calls for.
 */
import type { Pool } from 'pg';
import { BufferJSON, initAuthCreds } from '@whiskeysockets/baileys';
import type { AuthenticationCreds, SignalDataSet, SignalDataTypeMap, SignalKeyStore } from '@whiskeysockets/baileys';
import { encrypt, decrypt } from '@agentx/shared';
import type { EncryptedData } from '@agentx/shared';

type PgPool = Pick<Pool, 'query'>;

/**
 * Serialize a value that may contain Buffer/Uint8Array fields, then encrypt
 * the resulting JSON string.
 */
function encryptValue(value: unknown, dek: Buffer): EncryptedData {
  const json = JSON.stringify(value, BufferJSON.replacer);
  return encrypt(json, dek);
}

/**
 * Decrypt and parse a value serialized by {@link encryptValue}, restoring any
 * Buffer/Uint8Array fields.
 */
function decryptValue<T>(encrypted: EncryptedData, dek: Buffer): T {
  const json = decrypt(encrypted, dek);
  return JSON.parse(json, BufferJSON.reviver) as T;
}

/**
 * Stores the single `AuthenticationCreds` blob for the WhatsApp session.
 * Single row keyed by a fixed id, following the same one-row-per-platform
 * shape as `bot_credentials`/`TelegramStore`.
 */
export class WhatsAppCredsStore {
  constructor(private readonly pool: PgPool, private readonly dek: Buffer) {}

  async load(): Promise<AuthenticationCreds | null> {
    const res = await this.pool.query(
      'SELECT creds_enc, iv, tag FROM whatsapp_creds WHERE id = $1',
      ['default'],
    );
    const row = res.rows[0] as { creds_enc: string; iv: string; tag: string } | undefined;
    if (!row) return null;

    return decryptValue<AuthenticationCreds>(
      { ciphertext: row.creds_enc, iv: row.iv, tag: row.tag },
      this.dek,
    );
  }

  /** Load existing creds, or generate + persist a fresh set if none exist yet. */
  async loadOrInit(): Promise<AuthenticationCreds> {
    const existing = await this.load();
    if (existing) return existing;
    const fresh = initAuthCreds();
    await this.save(fresh);
    return fresh;
  }

  async save(creds: AuthenticationCreds): Promise<void> {
    const encrypted = encryptValue(creds, this.dek);
    await this.pool.query(
      `INSERT INTO whatsapp_creds (id, creds_enc, iv, tag, updated_at)
       VALUES ('default', $1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET
         creds_enc = EXCLUDED.creds_enc,
         iv = EXCLUDED.iv,
         tag = EXCLUDED.tag,
         updated_at = NOW()`,
      [encrypted.ciphertext, encrypted.iv, encrypted.tag],
    );
  }

  async clear(): Promise<void> {
    await this.pool.query('DELETE FROM whatsapp_creds WHERE id = $1', ['default']);
  }
}

/**
 * Postgres-backed implementation of Baileys' `SignalKeyStore` contract.
 * Each (category, keyId) pair is its own encrypted row so a busy session's
 * constant key churn (pre-keys, sessions, sender-keys) never requires
 * reading/re-encrypting/rewriting a single growing blob.
 *
 * Note: per the implementation plan (Phase 2.3.3), the caller is expected to
 * wrap this store with Baileys' own exported `makeCacheableSignalKeyStore()`
 * before handing it to the socket — that in-memory cache layer is what
 * prevents write-then-read races; this class only needs to be a correct,
 * durable backing store.
 */
export class WhatsAppSignalKeyStore implements SignalKeyStore {
  constructor(private readonly pool: PgPool, private readonly dek: Buffer) {}

  async get<T extends keyof SignalDataTypeMap>(
    type: T,
    ids: string[],
  ): Promise<{ [id: string]: SignalDataTypeMap[T] }> {
    if (ids.length === 0) return {};

    const res = await this.pool.query(
      `SELECT key_id, value_enc, iv, tag FROM whatsapp_signal_keys
       WHERE category = $1 AND key_id = ANY($2::text[])`,
      [type, ids],
    );

    const result: { [id: string]: SignalDataTypeMap[T] } = {};
    for (const row of res.rows as Array<{ key_id: string; value_enc: string; iv: string; tag: string }>) {
      result[row.key_id] = decryptValue<SignalDataTypeMap[T]>(
        { ciphertext: row.value_enc, iv: row.iv, tag: row.tag },
        this.dek,
      );
    }
    return result;
  }

  async set(data: SignalDataSet): Promise<void> {
    // A `set()` call can touch many (category, id) pairs across multiple
    // categories in one batch (Baileys does this routinely). Run it as a
    // single transaction so a partial failure can't leave the signal store
    // in a state that's inconsistent with what the socket believes it wrote.
    const client = await (this.pool as unknown as Pool).connect();
    try {
      await client.query('BEGIN');
      for (const category of Object.keys(data) as Array<keyof SignalDataTypeMap>) {
        const entries = data[category];
        if (!entries) continue;
        for (const keyId of Object.keys(entries)) {
          const value = entries[keyId];
          if (value === null || value === undefined) {
            await client.query(
              'DELETE FROM whatsapp_signal_keys WHERE category = $1 AND key_id = $2',
              [category, keyId],
            );
            continue;
          }
          const encrypted = encryptValue(value, this.dek);
          await client.query(
            `INSERT INTO whatsapp_signal_keys (category, key_id, value_enc, iv, tag, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (category, key_id) DO UPDATE SET
               value_enc = EXCLUDED.value_enc,
               iv = EXCLUDED.iv,
               tag = EXCLUDED.tag,
               updated_at = NOW()`,
            [category, keyId, encrypted.ciphertext, encrypted.iv, encrypted.tag],
          );
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async clear(): Promise<void> {
    await this.pool.query('DELETE FROM whatsapp_signal_keys');
  }
}

/**
 * Convenience factory combining creds + keys into a Baileys-compatible
 * `AuthenticationState`-shaped pair. Callers should wrap `.keys` with
 * `makeCacheableSignalKeyStore()` before use (Phase 2.3.3).
 */
export function createWhatsAppAuthStores(pool: PgPool, dek: Buffer): {
  credsStore: WhatsAppCredsStore;
  keyStore: WhatsAppSignalKeyStore;
} {
  return {
    credsStore: new WhatsAppCredsStore(pool, dek),
    keyStore: new WhatsAppSignalKeyStore(pool, dek),
  };
}

/** Delete all persisted Baileys auth material for the session (unlink/purge). */
export async function purgeWhatsAppAuthState(pool: PgPool, dek: Buffer): Promise<void> {
  const { credsStore, keyStore } = createWhatsAppAuthStores(pool, dek);
  await credsStore.clear();
  await keyStore.clear();
}

/** Row shape for the `whatsapp_session` table (used by WhatsAppSessionService). */
export interface SessionRow {
  id: string;
  status: string;
  engine: string;
  phone_number: string | null;
  push_name: string | null;
  last_error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  connected_at: Date | string | null;
  last_active_at: Date | string | null;
}
