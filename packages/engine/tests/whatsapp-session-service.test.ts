import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Pool } from 'pg';

/**
 * WhatsAppSessionService unit tests (Phase 3.7).
 *
 * Mocks the engine factory and DB pool to test:
 *   - link/stop lifecycle
 *   - status persistence
 *   - event bus fan-out
 *   - concurrent link/stop guard
 *   - forceKill
 *   - unlink (credential purge)
 *   - boot-time reconciliation
 */
import { WhatsAppSessionService } from '../src/whatsapp/WhatsAppSessionService.js';
import { purgeWhatsAppAuthState } from '../src/whatsapp/WhatsAppStore.js';
import { WhatsAppEventBus } from '../src/whatsapp/WhatsAppEventBus.js';
import { EngineStatus } from '../src/whatsapp/engine/IWhatsAppEngine.js';
import type { IWhatsAppEngine, WhatsAppEngineCallbacks, WhatsAppIncomingMessage } from '../src/whatsapp/engine/IWhatsAppEngine.js';

// ─── Mock engine ─────────────────────────────────────────────────────────

class MockEngine implements IWhatsAppEngine {
  readonly name = 'baileys' as const;
  private status: EngineStatus = EngineStatus.DISCONNECTED;
  private callbacks: WhatsAppEngineCallbacks = {};
  private qr: string | null = null;
  public initializeCalled = false;
  public destroyCalled = false;
  public forceDestroyCalled = false;
  public disconnectCalled = false;
  public logoutFromServerCalled = false;
  public livenessResult = true;

  setCallbacks(callbacks: WhatsAppEngineCallbacks): void {
    this.callbacks = callbacks;
  }

  async initialize(): Promise<void> {
    this.initializeCalled = true;
    this.status = EngineStatus.INITIALIZING;
    this.callbacks.onStateChanged?.(this.status);
    // Simulate QR being emitted
    this.status = EngineStatus.QR_READY;
    this.qr = 'data:image/png;base64,FAKE';
    this.callbacks.onStateChanged?.(this.status);
    this.callbacks.onQRCode?.(this.qr);
    // Simulate ready
    this.status = EngineStatus.READY;
    this.qr = null;
    this.callbacks.onStateChanged?.(this.status, { phoneNumber: '15551234567', pushName: 'TestBot' });
  }

  async disconnect(): Promise<void> {
    this.disconnectCalled = true;
    this.status = EngineStatus.DISCONNECTED;
    this.callbacks.onStateChanged?.(this.status);
  }

  async forceDestroy(): Promise<void> {
    this.forceDestroyCalled = true;
    this.status = EngineStatus.DISCONNECTED;
  }

  async logoutFromServer(): Promise<void> {
    this.logoutFromServerCalled = true;
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  getQr(): string | null {
    return this.qr;
  }

  async requestPairingCode(phone: string): Promise<string> {
    this.status = EngineStatus.PAIRING;
    this.callbacks.onStateChanged?.(this.status);
    const code = `PAIR-${phone.slice(-4)}`;
    this.callbacks.onPairingCode?.(code);
    return code;
  }

  async probeLiveness(): Promise<boolean> {
    return this.livenessResult;
  }

  supportsCapability(): boolean {
    return true;
  }

  // Send methods — stubs
  async sendText(): Promise<{ messageId: string; timestamp: number }> { return { messageId: 'm1', timestamp: 0 }; }
  async sendImage(): Promise<{ messageId: string; timestamp: number }> { return { messageId: 'm1', timestamp: 0 }; }
  async sendVideo(): Promise<{ messageId: string; timestamp: number }> { return { messageId: 'm1', timestamp: 0 }; }
  async sendAudio(): Promise<{ messageId: string; timestamp: number }> { return { messageId: 'm1', timestamp: 0 }; }
  async sendDocument(): Promise<{ messageId: string; timestamp: number }> { return { messageId: 'm1', timestamp: 0 }; }
  async sendLocation(): Promise<{ messageId: string; timestamp: number }> { return { messageId: 'm1', timestamp: 0 }; }
  async sendContact(): Promise<{ messageId: string; timestamp: number }> { return { messageId: 'm1', timestamp: 0 }; }
  async sendPoll(): Promise<{ messageId: string; timestamp: number }> { return { messageId: 'm1', timestamp: 0 }; }
  async sendSticker(): Promise<{ messageId: string; timestamp: number }> { return { messageId: 'm1', timestamp: 0 }; }
  async reply(): Promise<{ messageId: string; timestamp: number }> { return { messageId: 'm1', timestamp: 0 }; }
  async forwardMessage(): Promise<{ messageId: string; timestamp: number }> { return { messageId: 'm1', timestamp: 0 }; }
  async react(): Promise<void> {}
  async editMessage(): Promise<void> {}
  async deleteMessage(): Promise<void> {}
  async checkNumberExists(): Promise<{ exists: boolean; jid?: string }> { return { exists: true, jid: 'x@c.us' }; }
  async blockContact(): Promise<void> {}
  async unblockContact(): Promise<void> {}
  async rejectCall(): Promise<void> {}

  // Test helper: simulate an inbound message
  simulateInboundMessage(body: string): void {
    const msg: WhatsAppIncomingMessage = {
      id: 'm1', chatId: 'c1', from: 'sender@c.us', to: 'me@c.us',
      fromMe: false, isGroup: false, type: 'text', body, timestamp: Date.now(),
    };
    this.callbacks.onMessage?.(msg);
  }

  simulateDisconnect(reason: string): void {
    this.status = EngineStatus.DISCONNECTED;
    this.callbacks.onDisconnected?.(reason);
  }

  simulateError(error: Error): void {
    this.callbacks.onError?.(error);
  }
}

// ─── Mock pool ───────────────────────────────────────────────────────────

function createMockPool(sessionRow?: Record<string, unknown>) {
  const queryFn = vi.fn(async (text: string, _params?: unknown[]) => {
    if (text.startsWith('SELECT * FROM whatsapp_session')) {
      return { rows: sessionRow ? [sessionRow] : [] };
    }
    return { rows: [] };
  });
  return { query: queryFn } as unknown as Pool & { query: ReturnType<typeof vi.fn> };
}

// ─── Mock the engine factory ─────────────────────────────────────────────

let mockEngine: MockEngine;

vi.mock('../src/whatsapp/engine/EngineFactory.js', () => ({
  createWhatsAppEngine: vi.fn(() => {
    mockEngine = new MockEngine();
    return mockEngine;
  }),
}));

const registeredCreds = { value: false };

vi.mock('../src/whatsapp/WhatsAppStore.js', () => ({
  purgeWhatsAppAuthState: vi.fn(async () => {}),
  hasRegisteredWhatsAppCreds: vi.fn(async () => registeredCreds.value),
}));

// ─── Tests ───────────────────────────────────────────────────────────────

describe('WhatsAppSessionService', () => {
  let pool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    pool = createMockPool();
    mockEngine = new MockEngine();
    registeredCreds.value = false;
    vi.mocked(purgeWhatsAppAuthState).mockClear();
  });

  describe('link()', () => {
    it('creates the engine and initializes it', async () => {
      const service = new WhatsAppSessionService({ pool, dek: Buffer.alloc(32) });
      await service.link();

      expect(mockEngine.initializeCalled).toBe(true);
      const status = await service.getStatus();
      expect(status.status).toBe(EngineStatus.READY);
    });

    it('emits stateChanged events through the event bus', async () => {
      const service = new WhatsAppSessionService({ pool, dek: Buffer.alloc(32) });
      const states: EngineStatus[] = [];
      service.events.on('stateChanged', (s) => states.push(s));

      await service.link();
      expect(states).toContain(EngineStatus.INITIALIZING);
      expect(states).toContain(EngineStatus.QR_READY);
      expect(states).toContain(EngineStatus.READY);
    });

    it('emits qrCode events through the event bus', async () => {
      const service = new WhatsAppSessionService({ pool, dek: Buffer.alloc(32) });
      const qrCodes: string[] = [];
      service.events.on('qrCode', (url) => qrCodes.push(url));

      await service.link();
      expect(qrCodes).toEqual(['data:image/png;base64,FAKE']);
    });

    it('does not purge registered credentials when reconnecting', async () => {
      registeredCreds.value = true;
      const service = new WhatsAppSessionService({ pool, dek: Buffer.alloc(32) });
      await service.link();
      expect(purgeWhatsAppAuthState).not.toHaveBeenCalled();
    });

    it('is idempotent — link() called while already active returns without throwing', async () => {
      const service = new WhatsAppSessionService({ pool, dek: Buffer.alloc(32) });
      await service.link();
      // Should not throw — just returns (caller can check getStatus())
      await expect(service.link()).resolves.toBeUndefined();
    });

    it('persists session status to the DB', async () => {
      const service = new WhatsAppSessionService({ pool, dek: Buffer.alloc(32) });
      await service.link();
      // The upsertSessionRow should have been called multiple times
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO whatsapp_session'),
        expect.any(Array),
      );
    });
  });

  describe('event bus fan-out', () => {
    it('routes inbound messages through the event bus', async () => {
      const service = new WhatsAppSessionService({ pool, dek: Buffer.alloc(32) });
      const messages: string[] = [];
      service.events.on('message', (msg) => messages.push(msg.body));

      await service.link();
      mockEngine.simulateInboundMessage('hello from test');
      await vi.waitFor(() => expect(messages).toEqual(['hello from test']));
    });

    it('routes disconnected events through the event bus', async () => {
      const service = new WhatsAppSessionService({ pool, dek: Buffer.alloc(32) });
      const reasons: string[] = [];
      service.events.on('disconnected', (reason) => reasons.push(reason));

      await service.link();
      mockEngine.simulateDisconnect('connection lost');
      expect(reasons).toEqual(['connection lost']);
    });

    it('routes error events through the event bus', async () => {
      const service = new WhatsAppSessionService({ pool, dek: Buffer.alloc(32) });
      const errors: string[] = [];
      service.events.on('error', (err) => errors.push(err.message));

      await service.link();
      mockEngine.simulateError(new Error('test error'));
      expect(errors).toEqual(['test error']);
    });
  });

  describe('stop()', () => {
    it('disconnects the engine', async () => {
      const service = new WhatsAppSessionService({ pool, dek: Buffer.alloc(32) });
      await service.link();
      await service.stop();

      expect(mockEngine.disconnectCalled).toBe(true);
      const status = await service.getStatus();
      expect(status.status).toBe(EngineStatus.DISCONNECTED);
    });

    it('allows re-linking after stop', async () => {
      const service = new WhatsAppSessionService({ pool, dek: Buffer.alloc(32) });
      await service.link();
      await service.stop();
      // Should not throw
      await service.link();
      expect(mockEngine.initializeCalled).toBe(true);
    });
  });

  describe('forceKill()', () => {
    it('force-destroys the engine', async () => {
      const service = new WhatsAppSessionService({ pool, dek: Buffer.alloc(32) });
      await service.link();
      await service.forceKill();

      expect(mockEngine.forceDestroyCalled).toBe(true);
    });
  });

  describe('unlink()', () => {
    it('revokes the device, stops the engine, and purges auth state', async () => {
      const service = new WhatsAppSessionService({ pool, dek: Buffer.alloc(32) });
      await service.link();
      await service.unlink();

      expect(mockEngine.logoutFromServerCalled).toBe(true);
      expect(mockEngine.disconnectCalled).toBe(true);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM whatsapp_session'),
        expect.any(Array),
      );
    });
  });

  describe('remote logout', () => {
    it('purges the session when the phone revokes the linked device', async () => {
      const service = new WhatsAppSessionService({ pool, dek: Buffer.alloc(32) });
      await service.link();
      mockEngine.simulateDisconnect('logged_out (401)');
      await new Promise((r) => setTimeout(r, 20));
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM whatsapp_session'),
        expect.any(Array),
      );
    });
  });

  describe('requestPairingCode()', () => {
    it('delegates to the engine', async () => {
      const service = new WhatsAppSessionService({ pool, dek: Buffer.alloc(32) });
      await service.link();

      const codes: string[] = [];
      service.events.on('pairingCode', (code) => codes.push(code));

      const result = await service.requestPairingCode('15551234567');
      expect(result).toBe('PAIR-4567');
      expect(codes).toEqual(['PAIR-4567']);
    });

    it('throws if engine is not initialized', async () => {
      const service = new WhatsAppSessionService({ pool, dek: Buffer.alloc(32) });
      await expect(service.requestPairingCode('15551234567')).rejects.toThrow(/link\(\) first/);
    });
  });

  describe('getQr()', () => {
    it('returns null before link', () => {
      const service = new WhatsAppSessionService({ pool, dek: Buffer.alloc(32) });
      expect(service.getQr()).toBeNull();
    });

    it('returns the QR code after link (if engine has one)', async () => {
      const service = new WhatsAppSessionService({ pool, dek: Buffer.alloc(32) });
      await service.link();
      // After full initialization, QR is cleared (status is READY)
      expect(service.getQr()).toBeNull();
    });
  });

  describe('reconcileOnBoot()', () => {
    it('resets stale "initializing" state to "disconnected"', async () => {
      const stalePool = createMockPool({ id: 'default', status: 'initializing', engine: 'baileys' });
      const service = new WhatsAppSessionService({ pool: stalePool, dek: Buffer.alloc(32) });

      await service.reconcileOnBoot();

      expect(stalePool.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT'),
        expect.arrayContaining([expect.any(String), EngineStatus.DISCONNECTED]),
      );
    });

    it('auto-restarts if previously "ready"', async () => {
      const readyPool = createMockPool({ id: 'default', status: 'ready', engine: 'baileys', phone_number: '15551234567' });
      const service = new WhatsAppSessionService({ pool: readyPool, dek: Buffer.alloc(32) });

      await service.reconcileOnBoot();
      expect(mockEngine.initializeCalled).toBe(true);
    });

    it('auto-restarts a linked session even if last status was disconnected', async () => {
      registeredCreds.value = true;
      const downPool = createMockPool({ id: 'default', status: 'disconnected', engine: 'baileys', phone_number: '15551234567' });
      const service = new WhatsAppSessionService({ pool: downPool, dek: Buffer.alloc(32) });

      await service.reconcileOnBoot();
      expect(mockEngine.initializeCalled).toBe(true);
    });

    it('does nothing if no session record exists', async () => {
      const emptyPool = createMockPool();
      const service = new WhatsAppSessionService({ pool: emptyPool, dek: Buffer.alloc(32) });

      await service.reconcileOnBoot();
      // No upsert should have been called (only the SELECT)
      const upsertCalls = emptyPool.query.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO'),
      );
      expect(upsertCalls).toHaveLength(0);
    });
  });

  describe('concurrent guard', () => {
    it('handles concurrent link() calls gracefully (idempotent)', async () => {
      const service = new WhatsAppSessionService({ pool, dek: Buffer.alloc(32) });
      // Start link but don't await
      const p1 = service.link();
      // A second concurrent link should not throw — just returns
      await expect(service.link()).resolves.toBeUndefined();
      await p1;
    });
  });
});
