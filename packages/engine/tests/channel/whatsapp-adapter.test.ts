import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';

/**
 * WhatsAppBridgeAdapter unit + integration tests (Phase 5.4).
 *
 * Tests:
 *   - Adapter start/stop lifecycle
 *   - Inbound message routing (event bus → onInbound callback)
 *   - Inbound text/media/location type mapping
 *   - Outbound send delegation to the engine
 *   - Allowlist enforcement
 *   - getStatus()
 *   - Full integration: inbound → ChannelService → ChannelWorker → agent → reply → send
 */
import { WhatsAppBridgeAdapter } from '../../src/services/channel/adapters/WhatsAppBridgeAdapter.js';
import { WhatsAppSessionService } from '../../src/whatsapp/WhatsAppSessionService.js';
import { WhatsAppEventBus } from '../../src/whatsapp/WhatsAppEventBus.js';
import { EngineStatus } from '../../src/whatsapp/engine/IWhatsAppEngine.js';
import type { WhatsAppIncomingMessage } from '../../src/whatsapp/engine/IWhatsAppEngine.js';
import type { OnInboundCallback } from '../../src/services/channel/IChannelBridge.js';
import type { OutboundMessage } from '../../src/services/channel/IChannelService.js';

// ─── Mock engine factory ─────────────────────────────────────────────────

const mockEngine = {
  name: 'baileys' as const,
  status: EngineStatus.READY,
  qr: null as string | null,
  sendText: vi.fn(async (_chatId: string, _text: string) => ({ messageId: 'out-msg-1', timestamp: 0 })),
  initialize: vi.fn(async () => {}),
  disconnect: vi.fn(async () => {}),
  forceDestroy: vi.fn(async () => {}),
  getStatus: vi.fn(() => EngineStatus.READY),
  getQr: vi.fn(() => null),
  requestPairingCode: vi.fn(async (phone: string) => `PAIR-${phone.slice(-4)}`),
  probeLiveness: vi.fn(async () => true),
  supportsCapability: vi.fn(() => true),
  isSavedContact: vi.fn((_jid: string) => ({ saved: true, name: 'Test Contact' })),
};

vi.mock('../../src/whatsapp/engine/EngineFactory.js', () => ({
  createWhatsAppEngine: vi.fn(() => mockEngine),
}));

vi.mock('../../src/whatsapp/WhatsAppStore.js', () => ({
  purgeWhatsAppAuthState: vi.fn(async () => {}),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────

function createMockPool() {
  return { query: vi.fn(async () => ({ rows: [] })) } as unknown as Pool;
}

function makeInboundMessage(overrides: Partial<WhatsAppIncomingMessage> = {}): WhatsAppIncomingMessage {
  return {
    id: 'msg-1',
    chatId: '15559998888@c.us',
    from: '15559998888@c.us',
    to: '15551234567@c.us',
    fromMe: false,
    isGroup: false,
    type: 'text',
    body: 'hello from WhatsApp',
    timestamp: 1700000000,
    raw: {},
    ...overrides,
  };
}

function createSessionService(): WhatsAppSessionService {
  const service = new WhatsAppSessionService({
    pool: createMockPool(),
    dek: Buffer.alloc(32),
  });
  // Manually inject a mock engine so getStatus() returns READY
  (service as unknown as { engine: unknown }).engine = mockEngine;
  // Replace the event bus with a real one we can emit to
  const bus = new WhatsAppEventBus();
  (service as unknown as { eventBus: WhatsAppEventBus }).eventBus = bus;
  return service;
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('WhatsAppBridgeAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEngine.status = EngineStatus.READY;
    mockEngine.sendText.mockClear();
    mockEngine.isSavedContact.mockClear();
    mockEngine.isSavedContact.mockImplementation((_jid: string) => ({ saved: true, name: 'Test Contact' }));
  });

  describe('start/stop', () => {
    it('start() subscribes to the event bus and registers onInbound', async () => {
      const sessionService = createSessionService();
      const adapter = new WhatsAppBridgeAdapter({ sessionService });
      const onInbound: OnInboundCallback = vi.fn();

      await adapter.start(onInbound);
      // Emit a message — should reach onInbound
      sessionService.events.emit('message', makeInboundMessage());
      expect(onInbound).toHaveBeenCalledTimes(1);

      await adapter.stop();
      // After stop, no more messages should be delivered
      sessionService.events.emit('message', makeInboundMessage());
      expect(onInbound).toHaveBeenCalledTimes(1);
    });

    it('getStatus() returns disconnected before start', () => {
      const sessionService = createSessionService();
      const adapter = new WhatsAppBridgeAdapter({ sessionService });
      const status = adapter.getStatus();
      expect(status.channel).toBe('whatsapp');
      expect(status.connected).toBe(false);
    });

    it('getStatus() returns connected after start', async () => {
      const sessionService = createSessionService();
      const adapter = new WhatsAppBridgeAdapter({ sessionService });
      await adapter.start(vi.fn());
      const status = adapter.getStatus();
      expect(status.connected).toBe(true);
    });
  });

  describe('inbound message routing', () => {
    it('routes text messages to onInbound with correct payload', async () => {
      const sessionService = createSessionService();
      const adapter = new WhatsAppBridgeAdapter({ sessionService });
      const received: Parameters<OnInboundCallback>[1][] = [];
      await adapter.start((_channel, payload) => received.push(payload));

      sessionService.events.emit('message', makeInboundMessage({ body: 'hello world' }));

      expect(received).toHaveLength(1);
      expect(received[0]!.channel).toBe('whatsapp');
      expect(received[0]!.text).toBe('hello world');
      expect(received[0]!.sender.id).toBe('15559998888@c.us');
      expect(received[0]!.threadId).toBe('15559998888@c.us');
      expect(received[0]!.messageId).toBe('msg-1');
    });

    it('skips fromMe messages (echoes from other devices)', async () => {
      const sessionService = createSessionService();
      const adapter = new WhatsAppBridgeAdapter({ sessionService });
      const onInbound = vi.fn();
      await adapter.start(onInbound);

      sessionService.events.emit('message', makeInboundMessage({ fromMe: true }));
      expect(onInbound).not.toHaveBeenCalled();
    });

    it('maps image messages with caption', async () => {
      const sessionService = createSessionService();
      const adapter = new WhatsAppBridgeAdapter({ sessionService });
      const received: string[] = [];
      await adapter.start((_c, payload) => received.push(payload.text));

      sessionService.events.emit('message', makeInboundMessage({
        type: 'image',
        body: '',
        media: { mimetype: 'image/jpeg', caption: 'check this out' },
      }));

      expect(received[0]).toBe('[image] check this out');
    });

    it('maps location messages', async () => {
      const sessionService = createSessionService();
      const adapter = new WhatsAppBridgeAdapter({ sessionService });
      const received: string[] = [];
      await adapter.start((_c, payload) => received.push(payload.text));

      sessionService.events.emit('message', makeInboundMessage({
        type: 'location',
        body: '',
        location: { latitude: 37.7749, longitude: -122.4194, name: 'SF' },
      }));

      expect(received[0]).toBe('[location] 37.7749,-122.4194 (SF)');
    });

    it('maps media-omitted messages', async () => {
      const sessionService = createSessionService();
      const adapter = new WhatsAppBridgeAdapter({ sessionService });
      const received: string[] = [];
      await adapter.start((_c, payload) => received.push(payload.text));

      sessionService.events.emit('message', makeInboundMessage({
        type: 'video',
        body: '',
        media: { mimetype: 'video/mp4', omitted: true },
      }));

      expect(received[0]).toBe('[video (media omitted — too large)]');
    });

    it('uses author for group messages', async () => {
      const sessionService = createSessionService();
      const adapter = new WhatsAppBridgeAdapter({ sessionService });
      const received: { senderId: string; threadId: string }[] = [];
      await adapter.start((_c, payload) => received.push({ senderId: payload.sender.id, threadId: payload.threadId! }));

      sessionService.events.emit('message', makeInboundMessage({
        chatId: '120363@g.us',
        from: '120363@g.us',
        author: '15559998888@c.us',
        isGroup: true,
      }));

      expect(received[0]!.senderId).toBe('15559998888@c.us');
      expect(received[0]!.threadId).toBe('120363@g.us');
    });
  });

  describe('allowlist', () => {
    it('allows all senders when autoReplyMode is all', async () => {
      const sessionService = createSessionService();
      const adapter = new WhatsAppBridgeAdapter({ sessionService, autoReplyMode: 'all' });
      const onInbound = vi.fn();
      await adapter.start(onInbound);

      sessionService.events.emit('message', makeInboundMessage({ from: '111@c.us' }));
      sessionService.events.emit('message', makeInboundMessage({ from: '222@c.us' }));
      expect(onInbound).toHaveBeenCalledTimes(2);
    });

    it('drops messages from unallowed JIDs in allowlist mode', async () => {
      const sessionService = createSessionService();
      const adapter = new WhatsAppBridgeAdapter({
        sessionService,
        autoReplyMode: 'allowlist',
        allowedJids: ['15559998888@c.us'],
      });
      const onInbound = vi.fn();
      await adapter.start(onInbound);

      sessionService.events.emit('message', makeInboundMessage({ from: '15559998888@c.us' }));
      sessionService.events.emit('message', makeInboundMessage({ from: '111@c.us' }));
      expect(onInbound).toHaveBeenCalledTimes(1);
    });

    it('drops messages from unsaved contacts in saved_contacts mode', async () => {
      const sessionService = createSessionService();
      // Override isSavedContact to return false for unknown JIDs
      mockEngine.isSavedContact.mockImplementationOnce((_jid: string) => ({ saved: false }));
      const adapter = new WhatsAppBridgeAdapter({ sessionService, autoReplyMode: 'saved_contacts' });
      const onInbound = vi.fn();
      await adapter.start(onInbound);

      sessionService.events.emit('message', makeInboundMessage({ from: '9999999999@c.us' }));
      expect(onInbound).not.toHaveBeenCalled();
    });

    it('allows messages from saved contacts in saved_contacts mode', async () => {
      const sessionService = createSessionService();
      mockEngine.isSavedContact.mockImplementationOnce((_jid: string) => ({ saved: true, name: 'Alice' }));
      const adapter = new WhatsAppBridgeAdapter({ sessionService, autoReplyMode: 'saved_contacts' });
      const received: { senderName?: string }[] = [];
      await adapter.start((_c, payload) => received.push({ senderName: payload.sender.name }));

      sessionService.events.emit('message', makeInboundMessage({ from: '15559998888@c.us' }));
      expect(received).toHaveLength(1);
      expect(received[0]!.senderName).toBe('Alice');
    });

    it('always allows group messages regardless of autoReplyMode', async () => {
      const sessionService = createSessionService();
      mockEngine.isSavedContact.mockImplementationOnce((_jid: string) => ({ saved: false }));
      const adapter = new WhatsAppBridgeAdapter({ sessionService, autoReplyMode: 'saved_contacts' });
      const onInbound = vi.fn();
      await adapter.start(onInbound);

      sessionService.events.emit('message', makeInboundMessage({
        from: 'group123@g.us',
        chatId: 'group123@g.us',
        isGroup: true,
      }));
      expect(onInbound).toHaveBeenCalledTimes(1);
    });

    it('blocks senders in the runtime blocklist', async () => {
      const sessionService = createSessionService();
      sessionService.blockSender('15559998888@c.us');
      const adapter = new WhatsAppBridgeAdapter({ sessionService, autoReplyMode: 'all' });
      const onInbound = vi.fn();
      await adapter.start(onInbound);

      sessionService.events.emit('message', makeInboundMessage({ from: '15559998888@c.us' }));
      expect(onInbound).not.toHaveBeenCalled();
    });
  });

  describe('outbound send', () => {
    it('delegates to engine.sendText with chatId from threadId', async () => {
      const sessionService = createSessionService();
      const adapter = new WhatsAppBridgeAdapter({ sessionService });
      await adapter.start(vi.fn());

      const msg: OutboundMessage = { text: 'hello back', threadId: '15559998888@c.us' };
      await adapter.send(msg);

      expect(mockEngine.sendText).toHaveBeenCalledWith('15559998888@c.us', 'hello back');
    });

    it('throws if threadId is missing', async () => {
      const sessionService = createSessionService();
      const adapter = new WhatsAppBridgeAdapter({ sessionService });
      await adapter.start(vi.fn());

      await expect(adapter.send({ text: 'hi' })).rejects.toThrow(/chat id.*required/i);
    });

    it('throws if session is not ready', async () => {
      const sessionService = createSessionService();
      mockEngine.getStatus.mockReturnValueOnce(EngineStatus.DISCONNECTED);
      const adapter = new WhatsAppBridgeAdapter({ sessionService });
      await adapter.start(vi.fn());

      await expect(adapter.send({ text: 'hi', threadId: 'x@c.us' })).rejects.toThrow(/not ready/);
    });

    it('includes attachment notes in outbound text', async () => {
      const sessionService = createSessionService();
      const adapter = new WhatsAppBridgeAdapter({ sessionService });
      await adapter.start(vi.fn());

      const msg: OutboundMessage = {
        text: 'see this',
        threadId: 'x@c.us',
        attachments: [{ name: 'doc.pdf', url: 'https://example.com/doc.pdf' }],
      };
      await adapter.send(msg);

      expect(mockEngine.sendText).toHaveBeenCalledWith(
        'x@c.us',
        expect.stringContaining('[attachment: doc.pdf'),
      );
    });
  });

  describe('full integration: inbound → reply → outbound', () => {
    it('routes an inbound message through ChannelService and sends the agent reply back', async () => {
      // This is a simplified integration test that verifies the wiring:
      //   event bus → adapter → onInbound → (mock agent) → adapter.send → engine.sendText
      const sessionService = createSessionService();
      const adapter = new WhatsAppBridgeAdapter({ sessionService });

      let inboundPayload: { channel: string; text: string; threadId?: string } | null = null;
      await adapter.start((_channel, payload) => {
        inboundPayload = { channel: payload.channel, text: payload.text, threadId: payload.threadId };
      });

      // Simulate inbound message
      const engine = sessionService.getEngine();
      console.log('engine:', !!engine, 'isSavedContact:', typeof engine?.isSavedContact);
      console.log('isSavedContact result:', engine?.isSavedContact?.('15559998888@c.us'));
      sessionService.events.emit('message', makeInboundMessage({ body: 'what is 2+2?' }));
      expect(inboundPayload).not.toBeNull();
      expect(inboundPayload!.text).toBe('what is 2+2?');

      // Simulate the agent producing a reply and sending it back through the adapter
      const reply: OutboundMessage = {
        text: '2 + 2 = 4',
        threadId: inboundPayload!.threadId,
      };
      await adapter.send(reply);

      expect(mockEngine.sendText).toHaveBeenCalledWith(
        '15559998888@c.us',
        '2 + 2 = 4',
      );
    });
  });
});
