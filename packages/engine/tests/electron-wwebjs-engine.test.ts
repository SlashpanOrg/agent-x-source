import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * ElectronWebJsEngine + wwebjs-message-mapper unit tests (Phase 2.4/2.7).
 *
 * Mocks `whatsapp-web.js` and `qrcode` to test:
 *   - message mapper type/ack mapping
 *   - engine status transitions (QR → READY)
 *   - send* method delegation to the mocked Client
 *   - event wiring → callbacks
 *   - EngineFactory fallback engine construction
 */
import type { Pool } from 'pg';

// ─── Mock event bus ──────────────────────────────────────────────────────

const handlers = new Map<string, ((...args: unknown[]) => void)[]>();

function emitEvent(event: string, ...args: unknown[]): void {
  for (const h of handlers.get(event) ?? []) {
    h(...args);
  }
}

// ─── Mock whatsapp-web.js ────────────────────────────────────────────────

const mockClient = {
  info: { wid: { user: '15551234567', server: 'c.us', _serialized: '15551234567@c.us' }, pushname: 'TestBot' },
  initialize: vi.fn(async () => {
    // Simulate the ready event firing after initialize
    emitEvent('ready');
  }),
  destroy: vi.fn(async () => {}),
  logout: vi.fn(async () => {}),
  requestPairingCode: vi.fn(async (phone: string) => `PAIR-${phone.slice(-4)}`),
  sendMessage: vi.fn(async (chatId: string, _content: unknown, _opts?: unknown) => ({
    id: { fromMe: true, remote: chatId, id: `msg-${Math.random().toString(36).slice(2, 8)}`, _serialized: `true_${chatId}_msg-${Math.random().toString(36).slice(2, 8)}` },
    timestamp: Math.floor(Date.now() / 1000),
    type: 'chat',
    body: '',
    from: '15551234567@c.us',
    to: chatId,
    fromMe: true,
    ack: 0,
    hasMedia: false,
    hasQuotedMsg: false,
    hasReaction: false,
    isStatus: false,
    isEphemeral: false,
    broadcast: false,
    deviceType: 'web',
    duration: '0',
    isForwarded: false,
    forwardingScore: 0,
    isStarred: false,
    links: [],
    mentionedIds: [],
    groupMentions: [],
    vCards: [],
    orderId: '',
    rawData: {},
    pollName: '',
    pollOptions: [],
    allowMultipleAnswers: false,
    isEventCaneled: false,
    eventStartTime: 0,
  })),
  sendReaction: vi.fn(async () => {}),
  getMessageById: vi.fn(async (id: string) => ({
    id: { fromMe: true, remote: '', id, _serialized: id },
    forward: vi.fn(async () => {}),
    edit: vi.fn(async () => null),
    delete: vi.fn(async () => {}),
    downloadMedia: vi.fn(async () => null),
  })),
  getNumberId: vi.fn(async (phone: string) => ({ user: phone, server: 'c.us', _serialized: `${phone}@c.us` })),
  isRegisteredUser: vi.fn(async () => true),
  getContactById: vi.fn(async () => ({ block: vi.fn(async () => true), unblock: vi.fn(async () => true) })),
  on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    let arr = handlers.get(event);
    if (!arr) { arr = []; handlers.set(event, arr); }
    arr.push(handler);
    return mockClient;
  }),
};

vi.mock('whatsapp-web.js', () => {
  // Mock constructors must be class-like (use `new`-callable functions).
  class MockLocalAuth {
    constructor(opts?: { dataPath?: string }) { this.opts = opts; }
    opts?: { dataPath?: string };
  }
  class MockMessageMedia {
    constructor(public mimetype: string, public data: string, public filename?: string) {}
  }
  class MockLocation {
    constructor(public latitude: string, public longitude: string, public opts?: { name?: string; address?: string }) {}
  }
  class MockPoll {
    constructor(public pollName: string, public pollOptions: string[], public options?: { allowMultipleAnswers?: boolean }) {}
  }
  class MockClient {
    constructor(_opts?: unknown) { return mockClient; }
  }
  const mocked = {
    Client: MockClient,
    LocalAuth: MockLocalAuth,
    MessageMedia: MockMessageMedia,
    Location: MockLocation,
    Poll: MockPoll,
    Events: {
      QR_RECEIVED: 'qr',
      AUTHENTICATED: 'authenticated',
      AUTHENTICATION_FAILURE: 'auth_failure',
      READY: 'ready',
      MESSAGE_RECEIVED: 'message',
      MESSAGE_CREATE: 'message_create',
      MESSAGE_ACK: 'message_ack',
      MESSAGE_EDIT: 'message_edit',
      MESSAGE_REVOKED_EVERYONE: 'message_revoke_everyone',
      MESSAGE_REACTION: 'message_reaction',
      GROUP_JOIN: 'group_join',
      GROUP_LEAVE: 'group_leave',
      GROUP_ADMIN_CHANGED: 'group_admin_changed',
      CALL: 'call',
      DISCONNECTED: 'disconnected',
    },
    MessageAck: {
      ACK_ERROR: -1, ACK_PENDING: 0, ACK_SERVER: 1, ACK_DEVICE: 2, ACK_READ: 3, ACK_PLAYED: 4,
    },
    MessageTypes: {
      TEXT: 'chat', AUDIO: 'audio', VOICE: 'ptt', IMAGE: 'image', VIDEO: 'video',
      DOCUMENT: 'document', STICKER: 'sticker', LOCATION: 'location',
      CONTACT_CARD: 'vcard', POLL_CREATION: 'poll_creation', REVOKED: 'revoked',
    },
  };
  return { ...mocked, default: mocked };
});

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,FAKEQR') },
}));

// ─── Static imports (hoisted after mocks) ────────────────────────────────

import { ElectronWebJsEngine } from '../src/whatsapp/engine/ElectronWebJsEngine.js';
import { createWhatsAppEngine } from '../src/whatsapp/engine/EngineFactory.js';
import { mapWWebJsMessage, ackStatusFromWWebJs } from '../src/whatsapp/engine/wwebjs-message-mapper.js';
import { MessageAck } from 'whatsapp-web.js';
import { randomBytes } from 'node:crypto';

// ─── Helpers ─────────────────────────────────────────────────────────────

function newEngine() {
  const engine = new ElectronWebJsEngine({
    cdpEndpoint: 'http://127.0.0.1:9222',
    dataPath: '/tmp/test-wwebjs',
  });
  return { engine };
}

function makeMockMessage(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: { fromMe: false, remote: '15559998888@c.us', id: 'm1', _serialized: 'false_15559998888@c.us_m1' },
    body: 'hello world',
    type: 'chat',
    timestamp: 1700000000,
    from: '15559998888@c.us',
    to: '15551234567@c.us',
    fromMe: false,
    ack: 0,
    hasMedia: false,
    hasQuotedMsg: false,
    hasReaction: false,
    isStatus: false,
    isEphemeral: false,
    broadcast: false,
    deviceType: 'web',
    duration: '0',
    isForwarded: false,
    forwardingScore: 0,
    isStarred: false,
    links: [],
    mentionedIds: [],
    groupMentions: [],
    vCards: [],
    orderId: '',
    rawData: {},
    pollName: '',
    pollOptions: [],
    allowMultipleAnswers: false,
    isEventCaneled: false,
    eventStartTime: 0,
    ...overrides,
  };
}

function resetMocks() {
  handlers.clear();
  mockClient.initialize.mockClear();
  mockClient.destroy.mockClear();
  mockClient.sendMessage.mockClear();
  mockClient.sendReaction.mockClear();
  mockClient.getMessageById.mockClear();
  mockClient.getNumberId.mockClear();
  mockClient.isRegisteredUser.mockClear();
  mockClient.getContactById.mockClear();
  mockClient.on.mockClear();
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('wwebjs-message-mapper', () => {
  it('maps a text message correctly', () => {
    const msg = makeMockMessage() as never;
    const result = mapWWebJsMessage(msg);
    expect(result.id).toBe('false_15559998888@c.us_m1');
    expect(result.chatId).toBe('15559998888@c.us');
    expect(result.from).toBe('15559998888@c.us');
    expect(result.to).toBe('15551234567@c.us');
    expect(result.fromMe).toBe(false);
    expect(result.isGroup).toBe(false);
    expect(result.type).toBe('text');
    expect(result.body).toBe('hello world');
    expect(result.timestamp).toBe(1700000000);
  });

  it('maps group messages with author', () => {
    const msg = makeMockMessage({
      from: '120363@g.us',
      author: '15559998888@c.us',
    }) as never;
    const result = mapWWebJsMessage(msg);
    expect(result.isGroup).toBe(true);
    expect(result.chatId).toBe('120363@g.us');
    expect(result.author).toBe('15559998888@c.us');
  });

  it('maps fromMe messages (chatId = to)', () => {
    const msg = makeMockMessage({
      fromMe: true,
      from: '15551234567@c.us',
      to: '15559998888@c.us',
    }) as never;
    const result = mapWWebJsMessage(msg);
    expect(result.fromMe).toBe(true);
    expect(result.chatId).toBe('15559998888@c.us');
  });

  it('maps message types correctly', () => {
    const cases: [string, string][] = [
      ['chat', 'text'],
      ['ptt', 'voice'],
      ['image', 'image'],
      ['video', 'video'],
      ['document', 'document'],
      ['sticker', 'sticker'],
      ['location', 'location'],
      ['vcard', 'contact'],
      ['poll_creation', 'poll'],
      ['unknown_type', 'unknown'],
    ];
    for (const [wwebjsType, expected] of cases) {
      const msg = makeMockMessage({ type: wwebjsType }) as never;
      expect(mapWWebJsMessage(msg).type).toBe(expected);
    }
  });

  it('maps ack statuses correctly', () => {
    expect(ackStatusFromWWebJs(MessageAck.ACK_ERROR)).toBe('failed');
    expect(ackStatusFromWWebJs(MessageAck.ACK_PENDING)).toBe('pending');
    expect(ackStatusFromWWebJs(MessageAck.ACK_SERVER)).toBe('sent');
    expect(ackStatusFromWWebJs(MessageAck.ACK_DEVICE)).toBe('delivered');
    expect(ackStatusFromWWebJs(MessageAck.ACK_READ)).toBe('read');
    expect(ackStatusFromWWebJs(MessageAck.ACK_PLAYED)).toBe('read');
  });

  it('maps location', () => {
    const msg = makeMockMessage({
      type: 'location',
      location: { latitude: '37.7749', longitude: '-122.4194', name: 'SF', address: 'CA' },
    }) as never;
    const result = mapWWebJsMessage(msg);
    expect(result.location).toEqual({
      latitude: 37.7749,
      longitude: -122.4194,
      name: 'SF',
      address: 'CA',
    });
  });
});

describe('ElectronWebJsEngine', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('lifecycle', () => {
    it('transitions to READY after initialize', async () => {
      const { engine } = newEngine();
      const states: string[] = [];
      engine.setCallbacks({ onStateChanged: (s) => states.push(s) });

      await engine.initialize();
      expect(engine.getStatus()).toBe('ready');
      expect(states).toContain('ready');
    });

    it('transitions to QR_READY on QR event', async () => {
      const { engine } = newEngine();
      const states: string[] = [];
      engine.setCallbacks({ onStateChanged: (s) => states.push(s) });

      // Don't call initialize (which fires ready); manually emit QR
      // We need to trigger the constructor + wireEvents first
      await engine.initialize();
      // Clear states from the ready event
      states.length = 0;
      emitEvent('qr', 'qr-string-123');
      expect(engine.getStatus()).toBe('qr_ready');
      expect(states).toContain('qr_ready');
    });

    it('emits QR data URL via onQRCode callback', async () => {
      const { engine } = newEngine();
      let qrUrl: string | undefined;
      engine.setCallbacks({ onQRCode: (url) => { qrUrl = url; } });

      await engine.initialize();
      emitEvent('qr', 'qr-string');
      await new Promise((r) => setTimeout(r, 10));
      expect(qrUrl).toBe('data:image/png;base64,FAKEQR');
    });

    it('disconnect() destroys the client', async () => {
      const { engine } = newEngine();
      await engine.initialize();
      await engine.disconnect();
      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
      expect(engine.getStatus()).toBe('disconnected');
    });

    it('forceDestroy() destroys the client', async () => {
      const { engine } = newEngine();
      await engine.initialize();
      await engine.forceDestroy();
      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
      expect(engine.getStatus()).toBe('disconnected');
    });

    it('throws when sendText called before initialize', async () => {
      const { engine } = newEngine();
      await expect(engine.sendText('x@c.us', 'hi')).rejects.toThrow(/initialize/);
    });
  });

  describe('pairing code', () => {
    it('delegates to client.requestPairingCode', async () => {
      const { engine } = newEngine();
      let code: string | undefined;
      engine.setCallbacks({ onPairingCode: (c) => { code = c; } });

      await engine.initialize();
      const result = await engine.requestPairingCode('15551234567');
      expect(mockClient.requestPairingCode).toHaveBeenCalledWith('15551234567');
      expect(result).toBe('PAIR-4567');
      expect(code).toBe('PAIR-4567');
      expect(engine.getStatus()).toBe('pairing');
    });
  });

  describe('messaging', () => {
    it('sendText delegates to sendMessage', async () => {
      const { engine } = newEngine();
      await engine.initialize();
      const result = await engine.sendText('15559998888@c.us', 'hello', { mentions: ['123@c.us'] });
      expect(mockClient.sendMessage).toHaveBeenCalledWith(
        '15559998888@c.us',
        'hello',
        expect.objectContaining({ mentions: ['123@c.us'] }),
      );
      expect(result.messageId).toMatch(/msg-/);
    });

    it('sendImage creates MessageMedia and sends', async () => {
      const { engine } = newEngine();
      await engine.initialize();
      await engine.sendImage('15559998888@c.us', { data: 'aGVsbG8=', mimetype: 'image/png', caption: 'cap' });
      expect(mockClient.sendMessage).toHaveBeenCalledWith(
        '15559998888@c.us',
        expect.objectContaining({ mimetype: 'image/png', data: 'aGVsbG8=' }),
        expect.objectContaining({ caption: 'cap' }),
      );
    });

    it('sendLocation creates a Location object', async () => {
      const { engine } = newEngine();
      await engine.initialize();
      await engine.sendLocation('15559998888@c.us', { latitude: 37.77, longitude: -122.41, name: 'SF' });
      const [, content] = mockClient.sendMessage.mock.calls.at(-1)!;
      // MockLocation stores lat/lon as-is (the real wwebjs Location converts to string)
      expect(content).toHaveProperty('latitude');
      expect(content).toHaveProperty('longitude');
    });

    it('sendPoll creates a Poll object', async () => {
      const { engine } = newEngine();
      await engine.initialize();
      await engine.sendPoll('group@g.us', 'Q?', ['A', 'B'], { selectableCount: 2 });
      const [, content] = mockClient.sendMessage.mock.calls.at(-1)!;
      expect(content.pollName).toBe('Q?');
      expect(content.pollOptions).toEqual(['A', 'B']);
      expect(content.options.allowMultipleAnswers).toBe(true);
    });

    it('react delegates to sendReaction', async () => {
      const { engine } = newEngine();
      await engine.initialize();
      await engine.react('15559998888@c.us', 'msg-id-123', '👍');
      expect(mockClient.sendReaction).toHaveBeenCalledWith('msg-id-123', '👍');
    });
  });

  describe('contacts', () => {
    it('checkNumberExists returns exists + jid', async () => {
      const { engine } = newEngine();
      await engine.initialize();
      const res = await engine.checkNumberExists('15559998888');
      expect(mockClient.getNumberId).toHaveBeenCalledWith('15559998888');
      expect(res.exists).toBe(true);
      expect(res.jid).toBe('15559998888@c.us');
    });

    it('blockContact calls contact.block()', async () => {
      const { engine } = newEngine();
      await engine.initialize();
      await engine.blockContact('15559998888@c.us');
      expect(mockClient.getContactById).toHaveBeenCalledWith('15559998888@c.us');
    });
  });

  describe('event wiring', () => {
    it('onMessage fires for inbound messages', async () => {
      const { engine } = newEngine();
      const messages: string[] = [];
      engine.setCallbacks({ onMessage: (m) => messages.push(m.body) });

      await engine.initialize();
      emitEvent('message', makeMockMessage({ body: 'hello from test' }));
      expect(messages).toEqual(['hello from test']);
    });

    it('onMessageAck fires on message_ack event', async () => {
      const { engine } = newEngine();
      const acks: string[] = [];
      engine.setCallbacks({ onMessageAck: (a) => acks.push(a.status) });

      await engine.initialize();
      emitEvent('message_ack', makeMockMessage({ ack: 3 })); // ACK_READ
      expect(acks).toEqual(['read']);
    });

    it('onMessageRevoked fires on message_revoke_everyone', async () => {
      const { engine } = newEngine();
      let revoked: { chatId: string; messageId: string } | undefined;
      engine.setCallbacks({ onMessageRevoked: (chatId, messageId) => { revoked = { chatId, messageId }; } });

      await engine.initialize();
      emitEvent('message_revoke_everyone', makeMockMessage());
      expect(revoked).toEqual({ chatId: '15559998888@c.us', messageId: 'false_15559998888@c.us_m1' });
    });

    it('onCallReceived fires for inbound calls', async () => {
      const { engine } = newEngine();
      let callEv: { callId: string; from: string; isVideo: boolean } | undefined;
      engine.setCallbacks({ onCallReceived: (c) => { callEv = { callId: c.callId, from: c.from, isVideo: c.isVideo }; } });

      await engine.initialize();
      emitEvent('call', { id: 'call-1', from: '15559998888@c.us', isVideo: true, timestamp: 1700000000, fromMe: false });
      expect(callEv).toEqual({ callId: 'call-1', from: '15559998888@c.us', isVideo: true });
    });

    it('onGroupEvent fires for group_join', async () => {
      const { engine } = newEngine();
      let groupEv: { groupId: string; action: string; participants: string[] } | undefined;
      engine.setCallbacks({
        onGroupEvent: (e) => { groupEv = { groupId: e.groupId, action: e.action, participants: e.participants }; },
      });

      await engine.initialize();
      emitEvent('group_join', { id: '120363@g.us', type: 'add', recipientIds: ['15559998888@c.us'], author: '15551112222@c.us' });
      expect(groupEv).toEqual({
        groupId: '120363@g.us',
        action: 'add',
        participants: ['15559998888@c.us'],
      });
    });
  });

  describe('capabilities', () => {
    it('supportsCapability returns true for wwebjs-supported capabilities', () => {
      const { engine } = newEngine();
      expect(engine.supportsCapability('labels')).toBe(true);
      expect(engine.supportsCapability('channels')).toBe(true);
      expect(engine.supportsCapability('chatHistoryFetch')).toBe(true);
      expect(engine.supportsCapability('groupManagement')).toBe(true);
    });

    it('supportsCapability returns false for rejectCall', () => {
      const { engine } = newEngine();
      expect(engine.supportsCapability('rejectCall')).toBe(false);
    });
  });
});

describe('EngineFactory (electron-wwebjs)', () => {
  it('creates an ElectronWebJsEngine when requested with cdpEndpoint', () => {
    const engine = createWhatsAppEngine({
      pool: { query: vi.fn() } as unknown as Pool,
      dek: randomBytes(32),
      engine: 'electron-wwebjs',
      electronWwebJs: { cdpEndpoint: 'http://127.0.0.1:9222' },
    });
    expect(engine.name).toBe('electron-wwebjs');
  });

  it('throws for electron-wwebjs without cdpEndpoint', () => {
    expect(() =>
      createWhatsAppEngine({
        pool: { query: vi.fn() } as unknown as Pool,
        dek: randomBytes(32),
        engine: 'electron-wwebjs',
      }),
    ).toThrow(/cdpEndpoint/);
  });
});
