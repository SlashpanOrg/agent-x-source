import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';

/**
 * BaileysEngine unit tests (Phase 2.7).
 *
 * The real Baileys socket requires a live WhatsApp server, so we mock
 * `@whiskeysockets/baileys` and `qrcode` and drive the engine through its
 * event surface. This exercises:
 *   - status transitions (DISCONNECTED → INITIALIZING → QR_READY → READY)
 *   - reconnect-with-backoff scheduling and cap
 *   - logged-out → FAILED + credential purge
 *   - message/ack/reaction/group/call event wiring → callbacks
 *   - send* methods delegating to the mocked socket
 *   - EngineFactory selection policy
 */

// Static imports — vi.mock() calls below are hoisted above these by vitest.
import { BaileysEngine } from '../src/whatsapp/engine/BaileysEngine.js';
import { createWhatsAppEngine } from '../src/whatsapp/engine/EngineFactory.js';

// ─── Mocks ───────────────────────────────────────────────────────────────

/** Captured listeners keyed by event name, so tests can emit synthetic events. */
const listeners = new Map<string, ((arg: never) => void)[]>();

function emit(event: string, arg: unknown): void {
  for (const l of listeners.get(event) ?? []) {
    l(arg as never);
  }
}

/** The mocked socket instance — tests inspect calls on these vi.fn fields. */
const mockSock = {
  user: { id: '15551234567@c.us', name: 'TestBot' },
  authState: { creds: { registered: false }, keys: {} },
  ev: {
    on: vi.fn((event: string, listener: (arg: never) => void) => {
      let arr = listeners.get(event);
      if (!arr) {
        arr = [];
        listeners.set(event, arr);
      }
      arr.push(listener);
    }),
    off: vi.fn((event: string, listener: (arg: never) => void) => {
      const arr = listeners.get(event);
      if (arr) {
        const i = arr.indexOf(listener);
        if (i >= 0) arr.splice(i, 1);
      }
    }),
    removeAllListeners: vi.fn((event: string) => {
      listeners.delete(event);
    }),
    emit: vi.fn(),
  },
  end: vi.fn(async () => {}),
  logout: vi.fn(async () => {}),
  requestPairingCode: vi.fn(async (phone: string) => `PAIR-${phone.slice(-4)}`),
  onWhatsApp: vi.fn(async (phone: string) => [{ jid: `${phone}@c.us`, exists: true }]),
  updateBlockStatus: vi.fn(async () => {}),
  rejectCall: vi.fn(async () => {}),
  sendMessage: vi.fn(async (jid: string, content: unknown) => ({
    key: { remoteJid: jid, id: `msg-${Math.random().toString(36).slice(2, 8)}`, fromMe: true },
    messageTimestamp: Math.floor(Date.now() / 1000),
  })),
};

vi.mock('@whiskeysockets/baileys', () => {
  return {
    makeWASocket: vi.fn(() => mockSock),
    makeCacheableSignalKeyStore: vi.fn((store: unknown) => store),
    Browsers: { appropriate: (b: string) => [b, 'Chrome', '1.0'] },
    fetchLatestWaWebVersion: vi.fn(async () => ({ version: [2, 3000, 1017] as [number, number, number], isLatest: true })),
    initAuthCreds: vi.fn(() => ({ noiseKey: {}, signedIdentityKey: {}, signedPreKey: {}, registrationId: 1, accountSyncCounter: 0, accountSettings: { unarchiveChats: false }, firstUnuploadedPreKeyId: 0, nextPreKeyId: 0, registered: false, pairingCode: undefined, lastPropHash: undefined, routingInfo: undefined, processedHistoryMessages: [] })),
    BufferJSON: {
      replacer: (_k: string, v: unknown) => v,
      reviver: (_k: string, v: unknown) => v,
    },
    DisconnectReason: { loggedOut: 401, connectionClosed: 428, restartRequired: 515 },
    getContentType: vi.fn((msg: Record<string, unknown>) => {
      if (msg.conversation) return 'conversation';
      if (msg.extendedTextMessage) return 'extendedTextMessage';
      if (msg.imageMessage) return 'imageMessage';
      if (msg.protocolMessage) return 'protocolMessage';
      return undefined;
    }),
    downloadMediaMessage: vi.fn(async () => Buffer.from('fake-media')),
    proto: {
      WebMessageInfo: {
        Status: { ERROR: 0, PENDING: 1, SERVER_ACK: 2, DELIVERY_ACK: 3, READ: 4, PLAYED: 5 },
      },
      Message: {
        ProtocolMessage: { Type: { REVOKE: 0 } },
      },
    },
  };
});

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,FAKEQR') },
}));

// ─── Fake pg.Pool (reuses the same SQL-stub pattern as whatsapp-store.test.ts) ──

class FakePgPool {
  private credsRow: { creds_enc: string; iv: string; tag: string } | undefined;
  private signalKeys = new Map<string, { value_enc: string; iv: string; tag: string }>();
  private lidRows = new Map<string, string | null>();

  async query(sql: string, params: unknown[] = []): Promise<{ rows: Array<Record<string, unknown>> }> {
    const s = sql.trim();
    if (s.startsWith('SELECT creds_enc')) return { rows: this.credsRow ? [this.credsRow] : [] };
    if (s.startsWith('INSERT INTO whatsapp_creds')) {
      const [ciphertext, iv, tag] = params as [string, string, string];
      this.credsRow = { creds_enc: ciphertext, iv, tag };
      return { rows: [] };
    }
    if (s.startsWith('DELETE FROM whatsapp_creds')) { this.credsRow = undefined; return { rows: [] }; }
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
    if (s === 'DELETE FROM whatsapp_signal_keys') { this.signalKeys.clear(); return { rows: [] }; }
    if (s.startsWith('SELECT lid, phone FROM whatsapp_lid_mapping')) {
      return { rows: Array.from(this.lidRows.entries()).map(([lid, phone]) => ({ lid, phone })) };
    }
    if (s.startsWith('INSERT INTO whatsapp_lid_mapping')) {
      const [lid, phone] = params as [string, string | null];
      this.lidRows.set(lid, phone);
      return { rows: [] };
    }
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
    throw new Error(`FakePgPool: unhandled query: ${s}`);
  }

  async connect() { return this; }
  release() { /* noop */ }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function newEngine() {
  const pool = new FakePgPool();
  const dek = randomBytes(32);
  const engine = new BaileysEngine({
    pool: pool as unknown as Pool,
    dek,
    reconnect: { initialDelayMs: 10, maxDelayMs: 50, maxAttempts: 3 },
  });
  return { engine, pool };
}

function resetMocks(): void {
  listeners.clear();
  mockSock.ev.on.mockClear();
  mockSock.ev.off.mockClear();
  mockSock.ev.removeAllListeners.mockClear();
  mockSock.end.mockClear();
  mockSock.logout.mockClear();
  mockSock.requestPairingCode.mockClear();
  mockSock.onWhatsApp.mockClear();
  mockSock.updateBlockStatus.mockClear();
  mockSock.rejectCall.mockClear();
  mockSock.sendMessage.mockClear();
  mockSock.authState.creds.registered = false;
  mockSock.user = { id: '15551234567@c.us', name: 'TestBot' };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('BaileysEngine', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('lifecycle & status transitions', () => {
    it('transitions DISCONNECTED → INITIALIZING → QR_READY on QR event', async () => {
      const { engine } = newEngine();
      const states: string[] = [];
      engine.setCallbacks({ onStateChanged: (s) => states.push(s) });

      await engine.initialize();
      expect(engine.getStatus()).toBe('initializing');

      // Emit a QR
      emit('connection.update', { qr: 'qr-string-123' });
      expect(engine.getStatus()).toBe('qr_ready');
      expect(states).toContain('qr_ready');
    });

    it('transitions to READY on connection.open', async () => {
      const { engine } = newEngine();
      const states: string[] = [];
      let phone: string | undefined;
      engine.setCallbacks({
        onStateChanged: (s, info) => {
          states.push(s);
          phone = info?.phoneNumber;
        },
      });

      await engine.initialize();
      emit('connection.update', { connection: 'open' });
      expect(engine.getStatus()).toBe('ready');
      expect(phone).toBe('15551234567');
    });

    it('emits QR data URL via onQRCode callback', async () => {
      const { engine } = newEngine();
      let qrDataUrl: string | undefined;
      engine.setCallbacks({ onQRCode: (url) => { qrDataUrl = url; } });

      await engine.initialize();
      emit('connection.update', { qr: 'qr-string' });
      // QRCode.toDataURL is async; flush microtasks
      await new Promise((r) => setTimeout(r, 0));
      expect(qrDataUrl).toBe('data:image/png;base64,FAKEQR');
    });

    it('disconnect() ends the socket and transitions to DISCONNECTED', async () => {
      const { engine } = newEngine();
      const states: string[] = [];
      engine.setCallbacks({ onStateChanged: (s) => states.push(s) });

      await engine.initialize();
      emit('connection.update', { connection: 'open' });
      await engine.disconnect();

      expect(mockSock.end).toHaveBeenCalledTimes(1);
      expect(engine.getStatus()).toBe('disconnected');
    });

    it('forceDestroy() logs out and ends the socket', async () => {
      const { engine } = newEngine();
      await engine.initialize();
      emit('connection.update', { connection: 'open' });
      await engine.forceDestroy();

      expect(mockSock.logout).toHaveBeenCalledTimes(1);
      expect(mockSock.end).toHaveBeenCalledTimes(1);
      expect(engine.getStatus()).toBe('disconnected');
    });
  });

  describe('reconnect with backoff', () => {
    it('schedules a reconnect on connection.close (not logged out)', async () => {
      const { engine } = newEngine();
      await engine.initialize();
      emit('connection.update', { connection: 'open' });

      // Trigger a close with a non-logged-out code
      emit('connection.update', {
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 428 } } as never, date: new Date() },
      });

      // Should be back to initializing (reconnect scheduled)
      expect(engine.getStatus()).toBe('initializing');
    });

    it('transitions to FAILED on logged-out and purges credentials', async () => {
      const { engine, pool } = newEngine();
      let disconnectedReason: string | undefined;
      engine.setCallbacks({ onDisconnected: (r) => { disconnectedReason = r; } });

      await engine.initialize();
      emit('connection.update', { connection: 'open' });

      // Insert a creds row so we can verify it gets purged
      await pool.query('INSERT INTO whatsapp_creds VALUES ($1, $2, $3)', ['enc', 'iv', 'tag']);
      let res = await pool.query('SELECT creds_enc FROM whatsapp_creds');
      expect(res.rows.length).toBe(1);

      emit('connection.update', {
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 401 } } as never, date: new Date() },
      });

      expect(engine.getStatus()).toBe('failed');
      expect(disconnectedReason).toContain('logged_out');
      // Credentials should be purged
      await new Promise((r) => setTimeout(r, 10));
      res = await pool.query('SELECT creds_enc FROM whatsapp_creds');
      expect(res.rows.length).toBe(0);
    });

    it('respects maxAttempts and transitions to FAILED', async () => {
      const { engine } = newEngine();
      const states: string[] = [];
      engine.setCallbacks({ onStateChanged: (s) => states.push(s), onDisconnected: () => {} });

      await engine.initialize();

      // Fire 4 close events (maxAttempts=3) — each triggers a reconnect schedule.
      for (let i = 0; i < 4; i++) {
        emit('connection.update', {
          connection: 'close',
          lastDisconnect: { error: { output: { statusCode: 428 } } as never, date: new Date() },
        });
      }

      expect(engine.getStatus()).toBe('failed');
    });
  });

  describe('pairing code', () => {
    it('requestPairingCode delegates to socket and emits PAIRING state', async () => {
      const { engine } = newEngine();
      const states: string[] = [];
      let code: string | undefined;
      engine.setCallbacks({
        onStateChanged: (s) => states.push(s),
        onPairingCode: (c) => { code = c; },
      });

      await engine.initialize();
      const result = await engine.requestPairingCode('15551234567');

      expect(mockSock.requestPairingCode).toHaveBeenCalledWith('15551234567');
      expect(result).toBe('PAIR-4567');
      expect(code).toBe('PAIR-4567');
      expect(engine.getStatus()).toBe('pairing');
    });

    it('throws if called before initialize()', async () => {
      const { engine } = newEngine();
      await expect(engine.requestPairingCode('15551234567')).rejects.toThrow(/initialize/);
    });
  });

  describe('messaging', () => {
    it('sendText delegates to socket.sendMessage with text content', async () => {
      const { engine } = newEngine();
      await engine.initialize();
      emit('connection.update', { connection: 'open' });

      const result = await engine.sendText('15559998888@c.us', 'hello world');
      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        '15559998888@c.us',
        expect.objectContaining({ text: 'hello world' }),
        expect.objectContaining({ quoted: undefined }),
      );
      expect(result.messageId).toMatch(/^msg-/);
      expect(typeof result.timestamp).toBe('number');
    });

    it('sendImage sends a Buffer with caption', async () => {
      const { engine } = newEngine();
      await engine.initialize();
      emit('connection.update', { connection: 'open' });

      await engine.sendImage('15559998888@c.us', { data: 'aGVsbG8=', mimetype: 'image/png', caption: 'cap' });
      const [, content] = mockSock.sendMessage.mock.calls.at(-1)!;
      expect(content).toHaveProperty('image');
      expect(Buffer.isBuffer(content.image)).toBe(true);
      expect(content.mimetype).toBe('image/png');
      expect(content.caption).toBe('cap');
    });

    it('sendPoll uses toAnnouncementGroup=false', async () => {
      const { engine } = newEngine();
      await engine.initialize();
      emit('connection.update', { connection: 'open' });

      await engine.sendPoll('group@g.us', 'Q?', ['A', 'B'], { selectableCount: 1 });
      const [, content] = mockSock.sendMessage.mock.calls.at(-1)!;
      expect(content.poll.name).toBe('Q?');
      expect(content.poll.values).toEqual(['A', 'B']);
      expect(content.poll.selectableCount).toBe(1);
      expect(content.poll.toAnnouncementGroup).toBe(false);
    });

    it('react sends a react content with the emoji', async () => {
      const { engine } = newEngine();
      await engine.initialize();
      emit('connection.update', { connection: 'open' });

      await engine.react('15559998888@c.us', 'msg-123', '👍');
      const [, content] = mockSock.sendMessage.mock.calls.at(-1)!;
      expect(content.react.text).toBe('👍');
      expect(content.react.key.id).toBe('msg-123');
    });

    it('deleteMessage sends a delete content', async () => {
      const { engine } = newEngine();
      await engine.initialize();
      emit('connection.update', { connection: 'open' });

      await engine.deleteMessage('15559998888@c.us', 'msg-123', true);
      const [, content] = mockSock.sendMessage.mock.calls.at(-1)!;
      expect(content.delete.id).toBe('msg-123');
    });

    it('sendContact builds a vCard', async () => {
      const { engine } = newEngine();
      await engine.initialize();
      emit('connection.update', { connection: 'open' });

      await engine.sendContact('15559998888@c.us', { displayName: 'Alice', phone: '15551112222', organization: 'Acme' });
      const [, content] = mockSock.sendMessage.mock.calls.at(-1)!;
      expect(content.contacts.displayName).toBe('Alice');
      const vcard = content.contacts.contacts[0].vcard as string;
      expect(vcard).toContain('BEGIN:VCARD');
      expect(vcard).toContain('FN:Alice');
      expect(vcard).toContain('ORG:Acme');
      expect(vcard).toContain('waid=15551112222');
    });

    it('throws when sendText is called before initialize()', async () => {
      const { engine } = newEngine();
      await expect(engine.sendText('x@c.us', 'hi')).rejects.toThrow(/initialize/);
    });
  });

  describe('contacts & calls', () => {
    it('checkNumberExists returns exists + neutral jid', async () => {
      const { engine } = newEngine();
      await engine.initialize();
      emit('connection.update', { connection: 'open' });

      const res = await engine.checkNumberExists('15559998888');
      expect(mockSock.onWhatsApp).toHaveBeenCalledWith('15559998888');
      expect(res.exists).toBe(true);
      expect(res.jid).toBe('15559998888@c.us');
    });

    it('blockContact / unblockContact delegate to updateBlockStatus', async () => {
      const { engine } = newEngine();
      await engine.initialize();
      emit('connection.update', { connection: 'open' });

      await engine.blockContact('15559998888@c.us');
      expect(mockSock.updateBlockStatus).toHaveBeenCalledWith('15559998888@c.us', 'block');
      mockSock.updateBlockStatus.mockClear();

      await engine.unblockContact('15559998888@c.us');
      expect(mockSock.updateBlockStatus).toHaveBeenCalledWith('15559998888@c.us', 'unblock');
    });

    it('rejectCall delegates to sock.rejectCall with tracked from-jid', async () => {
      const { engine } = newEngine();
      await engine.initialize();
      emit('connection.update', { connection: 'open' });

      // First, deliver a call so the engine tracks its origin
      emit('call', [{
        id: 'call-1',
        from: '15559998888@c.us',
        isVideo: false,
        status: 'offer',
        date: new Date(),
        offline: false,
      }]);

      await engine.rejectCall('call-1');
      expect(mockSock.rejectCall).toHaveBeenCalledWith('call-1', '15559998888@c.us');
    });
  });

  describe('event wiring → callbacks', () => {
    it('onMessage fires for inbound notify upserts', async () => {
      const { engine } = newEngine();
      const messages: string[] = [];
      engine.setCallbacks({ onMessage: (m) => messages.push(m.body) });

      await engine.initialize();
      emit('connection.update', { connection: 'open' });

      emit('messages.upsert', {
        messages: [{
          key: { remoteJid: '15559998888@c.us', id: 'm1', fromMe: false },
          message: { conversation: 'hello' },
          messageTimestamp: 1700000000,
        }],
        type: 'notify',
      });

      await new Promise((r) => setTimeout(r, 0));
      expect(messages).toEqual(['hello']);
    });

    it('onMessageAck fires on messages.update with status', async () => {
      const { engine } = newEngine();
      const acks: string[] = [];
      engine.setCallbacks({ onMessageAck: (a) => acks.push(a.status) });

      await engine.initialize();
      emit('connection.update', { connection: 'open' });

      emit('messages.update', [{
        key: { remoteJid: '15559998888@c.us', id: 'm1' },
        update: { status: 4 }, // READ
      }]);

      expect(acks).toEqual(['read']);
    });

    it('onMessageRevoked fires for REVOKE protocolMessage', async () => {
      const { engine } = newEngine();
      let revoked: { chatId: string; messageId: string } | undefined;
      engine.setCallbacks({ onMessageRevoked: (chatId, messageId) => { revoked = { chatId, messageId }; } });

      await engine.initialize();
      emit('connection.update', { connection: 'open' });

      emit('messages.update', [{
        key: { remoteJid: '15559998888@c.us', id: 'm1' },
        update: { protocolMessage: { type: 0 } }, // REVOKE
      }]);

      expect(revoked).toEqual({ chatId: '15559998888@c.us', messageId: 'm1' });
    });

    it('onMessageReaction fires with sender + emoji', async () => {
      const { engine } = newEngine();
      let reaction: { chatId: string; messageId: string; senderId: string; emoji: string | null } | undefined;
      engine.setCallbacks({
        onMessageReaction: (chatId, messageId, senderId, emoji) => {
          reaction = { chatId, messageId, senderId, emoji };
        },
      });

      await engine.initialize();
      emit('connection.update', { connection: 'open' });

      emit('messages.reaction', [{
        // r.key = the target message being reacted to
        key: { remoteJid: '15559998888@c.us', id: 'm1' },
        // r.reaction.key = the reactor's own message key
        reaction: { text: '🎉', key: { remoteJid: '15559998888@c.us', id: 'react-1', participant: '15557776666@c.us' } },
      }]);

      expect(reaction).toEqual({
        chatId: '15559998888@c.us',
        messageId: 'm1',
        senderId: '15557776666@c.us',
        emoji: '🎉',
      });
    });

    it('onGroupEvent fires for group-participants.update', async () => {
      const { engine } = newEngine();
      let groupEv: { groupId: string; action: string; participants: string[] } | undefined;
      engine.setCallbacks({
        onGroupEvent: (e) => { groupEv = { groupId: e.groupId, action: e.action, participants: e.participants }; },
      });

      await engine.initialize();
      emit('connection.update', { connection: 'open' });

      emit('group-participants.update', {
        id: '120363@g.us',
        author: '15551112222@c.us',
        participants: [{ id: '15559998888@c.us' }],
        action: 'add',
      });

      expect(groupEv).toEqual({
        groupId: '120363@g.us',
        action: 'add',
        participants: ['15559998888@c.us'],
      });
    });

    it('onCallReceived fires for call offers', async () => {
      const { engine } = newEngine();
      let callEv: { callId: string; from: string; isVideo: boolean } | undefined;
      engine.setCallbacks({ onCallReceived: (c) => { callEv = { callId: c.callId, from: c.from, isVideo: c.isVideo }; } });

      await engine.initialize();
      emit('connection.update', { connection: 'open' });

      emit('call', [{
        id: 'call-9',
        from: '15559998888@c.us',
        isVideo: true,
        status: 'offer',
        date: new Date(1700000000000),
        offline: false,
      }]);

      expect(callEv).toEqual({ callId: 'call-9', from: '15559998888@c.us', isVideo: true });
    });
  });

  describe('capabilities & liveness', () => {
    it('supportsCapability returns true for known capabilities', () => {
      const { engine } = newEngine();
      expect(engine.supportsCapability('chatHistoryFetch')).toBe(true);
      expect(engine.supportsCapability('labels')).toBe(true);
    });

    it('probeLiveness returns true when onWhatsApp confirms existence', async () => {
      const { engine } = newEngine();
      await engine.initialize();
      emit('connection.update', { connection: 'open' });

      const alive = await engine.probeLiveness();
      expect(alive).toBe(true);
      expect(mockSock.onWhatsApp).toHaveBeenCalled();
    });

    it('probeLiveness returns false before initialize', async () => {
      const { engine } = newEngine();
      const alive = await engine.probeLiveness();
      expect(alive).toBe(false);
    });
  });
});

describe('EngineFactory', () => {
  it('creates a BaileysEngine by default', () => {
    const pool = new FakePgPool();
    const engine = createWhatsAppEngine({ pool: pool as unknown as Pool, dek: randomBytes(32) });
    expect(engine.name).toBe('baileys');
  });

  it('creates an ElectronWebJsEngine when explicitly requested with cdpEndpoint', () => {
    const pool = new FakePgPool();
    const engine = createWhatsAppEngine({
      pool: pool as unknown as Pool,
      dek: randomBytes(32),
      engine: 'electron-wwebjs',
      electronWwebJs: { cdpEndpoint: 'http://127.0.0.1:9222' },
    });
    expect(engine.name).toBe('electron-wwebjs');
  });

  it('throws for electron-wwebjs without cdpEndpoint', () => {
    const pool = new FakePgPool();
    expect(() =>
      createWhatsAppEngine({ pool: pool as unknown as Pool, dek: randomBytes(32), engine: 'electron-wwebjs' }),
    ).toThrow(/cdpEndpoint/);
  });
});
