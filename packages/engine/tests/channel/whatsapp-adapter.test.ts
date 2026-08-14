import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { WhatsAppBridgeAdapter } from '../../src/services/channel/adapters/WhatsAppBridgeAdapter.js';
import { WhatsAppSessionService } from '../../src/whatsapp/WhatsAppSessionService.js';
import { WhatsAppEventBus } from '../../src/whatsapp/WhatsAppEventBus.js';
import { EngineStatus } from '../../src/whatsapp/engine/IWhatsAppEngine.js';
import type { WhatsAppIncomingMessage } from '../../src/whatsapp/engine/IWhatsAppEngine.js';
import type { WhatsAppJarvisRouter } from '../../src/whatsapp/jarvis/WhatsAppJarvisRouter.js';
import type { OnInboundCallback } from '../../src/services/channel/IChannelBridge.js';
import type { OutboundMessage } from '../../src/services/channel/IChannelService.js';

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
};

vi.mock('../../src/whatsapp/engine/EngineFactory.js', () => ({
  createWhatsAppEngine: vi.fn(() => mockEngine),
}));

vi.mock('../../src/whatsapp/WhatsAppStore.js', () => ({
  purgeWhatsAppAuthState: vi.fn(async () => {}),
  hasRegisteredWhatsAppCreds: vi.fn(async () => false),
}));

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
  (service as unknown as { engine: unknown }).engine = mockEngine;
  const bus = new WhatsAppEventBus();
  (service as unknown as { eventBus: WhatsAppEventBus }).eventBus = bus;
  return service;
}

describe('WhatsAppBridgeAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEngine.status = EngineStatus.READY;
    mockEngine.sendText.mockClear();
    mockEngine.getStatus.mockReturnValue(EngineStatus.READY);
  });

  describe('start/stop', () => {
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
      expect(adapter.getStatus().connected).toBe(true);
    });
  });

  describe('inbound routing', () => {
    it('does not call ChannelService onInbound (fail closed without Jarvis)', async () => {
      const sessionService = createSessionService();
      const adapter = new WhatsAppBridgeAdapter({ sessionService });
      const onInbound: OnInboundCallback = vi.fn();
      await adapter.start(onInbound);
      sessionService.events.emit('message', makeInboundMessage());
      expect(onInbound).not.toHaveBeenCalled();
    });

    it('forwards every inbound message including fromMe to the Jarvis router', async () => {
      const sessionService = createSessionService();
      const handleIncoming = vi.fn(async () => {});
      const jarvisRouter = { handleIncoming } as unknown as WhatsAppJarvisRouter;
      const adapter = new WhatsAppBridgeAdapter({ sessionService, jarvisRouter });
      await adapter.start(vi.fn());

      const world = makeInboundMessage({ body: 'from a contact' });
      const self = makeInboundMessage({
        fromMe: true,
        chatId: '15551234567@c.us',
        from: '15551234567@c.us',
        body: 'tell Mom I will be late',
      });
      sessionService.events.emit('message', world);
      sessionService.events.emit('message', self);

      expect(handleIncoming).toHaveBeenCalledTimes(2);
      expect(handleIncoming).toHaveBeenNthCalledWith(1, world);
      expect(handleIncoming).toHaveBeenNthCalledWith(2, self);
    });

    it('forwards group messages to the router (no auto-reply in the adapter)', async () => {
      const sessionService = createSessionService();
      const handleIncoming = vi.fn(async () => {});
      const adapter = new WhatsAppBridgeAdapter({
        sessionService,
        jarvisRouter: { handleIncoming } as unknown as WhatsAppJarvisRouter,
      });
      await adapter.start(vi.fn());
      sessionService.events.emit('message', makeInboundMessage({
        chatId: '120363@g.us',
        from: '120363@g.us',
        author: '15559998888@c.us',
        isGroup: true,
      }));
      expect(handleIncoming).toHaveBeenCalledTimes(1);
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
  });
});
