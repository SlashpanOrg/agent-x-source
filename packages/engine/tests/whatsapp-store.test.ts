import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { initAuthCreds } from '@whiskeysockets/baileys';
import { WhatsAppCredsStore, WhatsAppSignalKeyStore } from '../src/whatsapp/WhatsAppStore.js';

/**
 * Minimal in-memory stand-in for `pg.Pool` that understands exactly the SQL
 * statements `WhatsAppStore.ts` issues. This lets us exercise real
 * encrypt/decrypt + serialize/deserialize round-trips (including Buffer
 * fields) without a live Postgres connection.
 */
class FakePgPool {
  private credsRow: { creds_enc: string; iv: string; tag: string } | undefined;
  private signalKeys = new Map<string, { value_enc: string; iv: string; tag: string }>();

  async query(sql: string, params: unknown[] = []): Promise<{ rows: Array<Record<string, unknown>> }> {
    const s = sql.trim();

    if (s.startsWith('SELECT creds_enc')) {
      return { rows: this.credsRow ? [this.credsRow] : [] };
    }
    if (s.startsWith('INSERT INTO whatsapp_creds')) {
      const [ciphertext, iv, tag] = params as [string, string, string];
      this.credsRow = { creds_enc: ciphertext, iv, tag };
      return { rows: [] };
    }
    if (s.startsWith('DELETE FROM whatsapp_creds')) {
      this.credsRow = undefined;
      return { rows: [] };
    }
    if (s.startsWith('SELECT key_id, value_enc')) {
      const [category, ids] = params as [string, string[]];
      const rows: Array<Record<string, unknown>> = [];
      for (const id of ids) {
        const row = this.signalKeys.get(`${category}:${id}`);
        if (row) rows.push({ key_id: id, ...row });
      }
      return { rows };
    }
    if (s.startsWith('INSERT INTO whatsapp_signal_keys')) {
      const [category, keyId, ciphertext, iv, tag] = params as [string, string, string, string, string];
      this.signalKeys.set(`${category}:${keyId}`, { value_enc: ciphertext, iv, tag });
      return { rows: [] };
    }
    if (s.startsWith('DELETE FROM whatsapp_signal_keys WHERE category')) {
      const [category, keyId] = params as [string, string];
      this.signalKeys.delete(`${category}:${keyId}`);
      return { rows: [] };
    }
    if (s === 'DELETE FROM whatsapp_signal_keys') {
      this.signalKeys.clear();
      return { rows: [] };
    }
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') {
      return { rows: [] };
    }

    throw new Error(`FakePgPool: unhandled query: ${s}`);
  }

  async connect(): Promise<{ query: FakePgPool['query']; release: () => void }> {
    return {
      query: this.query.bind(this),
      release: () => {},
    };
  }
}

function makeDek(): Buffer {
  return randomBytes(32);
}

describe('WhatsAppCredsStore', () => {
  it('returns null when no creds have been saved', async () => {
    const pool = new FakePgPool();
    const store = new WhatsAppCredsStore(pool as never, makeDek());
    await expect(store.load()).resolves.toBeNull();
  });

  it('round-trips AuthenticationCreds, including Buffer/Uint8Array fields', async () => {
    const pool = new FakePgPool();
    const dek = makeDek();
    const store = new WhatsAppCredsStore(pool as never, dek);

    const creds = initAuthCreds();
    await store.save(creds);

    const loaded = await store.load();
    expect(loaded).not.toBeNull();
    expect(loaded?.registrationId).toBe(creds.registrationId);
    expect(loaded?.advSecretKey).toBe(creds.advSecretKey);
    // Buffer fields must survive the encrypt -> decrypt round trip as real Buffers.
    expect(Buffer.isBuffer(loaded?.noiseKey.public)).toBe(true);
    expect(Buffer.from(loaded!.noiseKey.public).equals(Buffer.from(creds.noiseKey.public))).toBe(true);
    expect(Buffer.from(loaded!.signedIdentityKey.private).equals(Buffer.from(creds.signedIdentityKey.private))).toBe(true);
  });

  it('loadOrInit generates and persists fresh creds exactly once', async () => {
    const pool = new FakePgPool();
    const store = new WhatsAppCredsStore(pool as never, makeDek());

    const first = await store.loadOrInit();
    const second = await store.loadOrInit();

    // Same persisted identity is returned on the second call, not regenerated.
    expect(second.registrationId).toBe(first.registrationId);
    expect(second.advSecretKey).toBe(first.advSecretKey);
  });

  it('clear() removes the stored creds', async () => {
    const pool = new FakePgPool();
    const store = new WhatsAppCredsStore(pool as never, makeDek());
    await store.save(initAuthCreds());
    await store.clear();
    await expect(store.load()).resolves.toBeNull();
  });

  it('decrypting with the wrong key fails (tamper/self-destruct property)', async () => {
    const pool = new FakePgPool();
    const store = new WhatsAppCredsStore(pool as never, makeDek());
    await store.save(initAuthCreds());

    const wrongKeyStore = new WhatsAppCredsStore(pool as never, makeDek());
    await expect(wrongKeyStore.load()).rejects.toThrow();
  });
});

describe('WhatsAppSignalKeyStore', () => {
  it('get() on unknown ids returns an empty object', async () => {
    const pool = new FakePgPool();
    const store = new WhatsAppSignalKeyStore(pool as never, makeDek());
    await expect(store.get('pre-key', ['1', '2'])).resolves.toEqual({});
  });

  it('get() with an empty id list short-circuits without querying', async () => {
    const pool = new FakePgPool();
    const store = new WhatsAppSignalKeyStore(pool as never, makeDek());
    await expect(store.get('pre-key', [])).resolves.toEqual({});
  });

  it('round-trips a pre-key (KeyPair with Buffer fields)', async () => {
    const pool = new FakePgPool();
    const store = new WhatsAppSignalKeyStore(pool as never, makeDek());

    const keyPair = { public: randomBytes(32), private: randomBytes(32) };
    await store.set({ 'pre-key': { '1': keyPair } });

    const result = await store.get('pre-key', ['1']);
    expect(Buffer.from(result['1'].public).equals(keyPair.public)).toBe(true);
    expect(Buffer.from(result['1'].private).equals(keyPair.private)).toBe(true);
  });

  it('round-trips a plain-JSON value type (app-state-sync-version)', async () => {
    const pool = new FakePgPool();
    const store = new WhatsAppSignalKeyStore(pool as never, makeDek());

    const value = { version: 3, hash: Buffer.from('abc'), indexValueMap: {} };
    await store.set({ 'app-state-sync-version': { main: value } });

    const result = await store.get('app-state-sync-version', ['main']);
    expect(result['main'].version).toBe(3);
    expect(Buffer.isBuffer(result['main'].hash)).toBe(true);
  });

  it('setting a value to null deletes it', async () => {
    const pool = new FakePgPool();
    const store = new WhatsAppSignalKeyStore(pool as never, makeDek());

    await store.set({ session: { a: Buffer.from('x') } });
    expect(await store.get('session', ['a'])).not.toEqual({});

    await store.set({ session: { a: null } });
    expect(await store.get('session', ['a'])).toEqual({});
  });

  it('handles a mixed batch across multiple categories in one set() call', async () => {
    const pool = new FakePgPool();
    const store = new WhatsAppSignalKeyStore(pool as never, makeDek());

    await store.set({
      'pre-key': { '1': { public: Buffer.from('pub'), private: Buffer.from('priv') } },
      session: { 'device-1': Buffer.from('session-bytes') },
    });

    const preKeys = await store.get('pre-key', ['1']);
    const sessions = await store.get('session', ['device-1']);
    expect(preKeys['1']).toBeDefined();
    expect(Buffer.from(sessions['device-1']).toString()).toBe('session-bytes');
  });

  it('clear() removes all keys across all categories', async () => {
    const pool = new FakePgPool();
    const store = new WhatsAppSignalKeyStore(pool as never, makeDek());

    await store.set({ 'pre-key': { '1': { public: Buffer.from('a'), private: Buffer.from('b') } } });
    await store.set({ session: { x: Buffer.from('c') } });
    await store.clear();

    expect(await store.get('pre-key', ['1'])).toEqual({});
    expect(await store.get('session', ['x'])).toEqual({});
  });
});
