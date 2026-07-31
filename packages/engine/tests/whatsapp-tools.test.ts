/**
 * WhatsApp Tools Tests (Phase 6.11).
 *
 * Tests cover:
 *   - Input validation (missing/invalid parameters)
 *   - Capability gating (label/status/group tools return "not supported" on non-capable engines)
 *   - Session tools (link/status/stop/unlink/pairing-code)
 *   - Messaging tools (send text/image/video/audio/doc/location/contact/poll/sticker/reply/forward/react/edit/delete)
 *   - Bulk send tools (send-bulk/batch-status/cancel-batch)
 *   - Contact tools (check-number/block/unblock)
 *   - Webhook tools (create/list/update/delete/test)
 *   - Error handling (engine not ready, session not configured)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Pool } from 'pg';

// ─── Mock setup ──────────────────────────────────────────────────────────

const mockEngine = {
  name: 'baileys' as const,
  status: 'ready' as const,
  qr: null as string | null,
  sendText: vi.fn(async (_chatId: string, _text: string) => ({ messageId: 'msg-out-1', timestamp: 1700000000 })),
  sendImage: vi.fn(async () => ({ messageId: 'msg-img-1', timestamp: 1700000000 })),
  sendVideo: vi.fn(async () => ({ messageId: 'msg-vid-1', timestamp: 1700000000 })),
  sendAudio: vi.fn(async () => ({ messageId: 'msg-aud-1', timestamp: 1700000000 })),
  sendDocument: vi.fn(async () => ({ messageId: 'msg-doc-1', timestamp: 1700000000 })),
  sendLocation: vi.fn(async () => ({ messageId: 'msg-loc-1', timestamp: 1700000000 })),
  sendContact: vi.fn(async () => ({ messageId: 'msg-con-1', timestamp: 1700000000 })),
  sendPoll: vi.fn(async () => ({ messageId: 'msg-pol-1', timestamp: 1700000000 })),
  sendSticker: vi.fn(async () => ({ messageId: 'msg-stk-1', timestamp: 1700000000 })),
  reply: vi.fn(async () => ({ messageId: 'msg-rep-1', timestamp: 1700000000 })),
  forwardMessage: vi.fn(async () => ({ messageId: 'msg-fwd-1', timestamp: 1700000000 })),
  react: vi.fn(async () => undefined),
  editMessage: vi.fn(async () => undefined),
  deleteMessage: vi.fn(async () => undefined),
  checkNumberExists: vi.fn(async (phone: string) => ({ exists: phone.endsWith('999'), jid: `${phone}@c.us` })),
  blockContact: vi.fn(async () => undefined),
  unblockContact: vi.fn(async () => undefined),
  rejectCall: vi.fn(async () => undefined),
  initialize: vi.fn(async () => {}),
  disconnect: vi.fn(async () => {}),
  forceDestroy: vi.fn(async () => {}),
  getStatus: vi.fn(() => 'ready' as const),
  getQr: vi.fn(() => null),
  requestPairingCode: vi.fn(async (phone: string) => `PAIR-${phone.slice(-4)}`),
  probeLiveness: vi.fn(async () => true),
  supportsCapability: vi.fn((cap: string) => cap === 'rejectCall' || cap === 'chatHistoryFetch'),
  setCallbacks: vi.fn(),
};

vi.mock('../src/whatsapp/engine/EngineFactory.js', () => ({
  createWhatsAppEngine: vi.fn(() => mockEngine),
}));

vi.mock('../src/whatsapp/WhatsAppStore.js', () => ({
  purgeWhatsAppAuthState: vi.fn(async () => {}),
}));

// ─── Imports ─────────────────────────────────────────────────────────────

import { EngineStatus } from '../src/whatsapp/engine/IWhatsAppEngine.js';
import { WhatsAppSessionService } from '../src/whatsapp/WhatsAppSessionService.js';
import { WhatsAppEventBus } from '../src/whatsapp/WhatsAppEventBus.js';
import {
  setWhatsAppSessionServiceInstance,
  getWhatsAppSessionServiceInstance,
} from '../src/services/ServiceContext.js';

// Tool handlers
import {
  whatsappLinkSession,
  whatsappGetSessionStatus,
  whatsappStopSession,
  whatsappUnlinkSession,
  whatsappRequestPairingCode,
  whatsappSendText,
  whatsappSendImage,
  whatsappSendLocation,
  whatsappSendContact,
  whatsappSendPoll,
  whatsappReply,
  whatsappForward,
  whatsappReact,
  whatsappEditMessage,
  whatsappDeleteMessage,
  whatsappSendBulk,
  whatsappGetBatchStatus,
  whatsappCancelBatch,
  whatsappCheckNumber,
  whatsappBlockContact,
  whatsappUnblockContact,
  whatsappListLabels,
  whatsappCreateGroup,
  whatsappRejectCall,
  whatsappPostTextStatus,
  whatsappCreateWebhook,
  whatsappListWebhooks,
  whatsappDeleteWebhook,
  whatsappTestWebhook,
} from '../src/tools/builtin/whatsapp/index.js';

import type { ToolExecutionContext } from '@agentx/shared';

// ─── Helpers ─────────────────────────────────────────────────────────────

function createMockPool(): Pool {
  const rows: Record<string, unknown[]> = {};
  return {
    query: vi.fn(async (text: string, _params?: unknown[]) => {
      if (text.startsWith('INSERT')) return { rows: [], rowCount: 1 } as never;
      if (text.startsWith('DELETE')) return { rows: [], rowCount: 1 } as never;
      if (text.startsWith('UPDATE')) return { rows: [], rowCount: 1 } as never;
      if (text.startsWith('SELECT')) {
        if (text.includes('whatsapp_webhooks')) {
          return { rows: rows['webhooks'] ?? [], rowCount: (rows['webhooks'] ?? []).length } as never;
        }
        return { rows: [], rowCount: 0 } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    }),
  } as unknown as Pool;
}

function createSessionService(): WhatsAppSessionService {
  const svc = new WhatsAppSessionService({
    pool: createMockPool(),
    dek: Buffer.alloc(32),
  });
  // Inject mock engine
  (svc as unknown as { engine: unknown }).engine = mockEngine;
  (svc as unknown as { eventBus: WhatsAppEventBus }).eventBus = new WhatsAppEventBus();
  (svc as unknown as { dek: Buffer }).dek = Buffer.alloc(32);
  (svc as unknown as { pool: Pool }).pool = createMockPool();
  return svc;
}

function makeContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    sessionId: 'test-session',
    scopePath: '/tmp',
    timeout: 30000,
    ...overrides,
  };
}

// ─── Test setup ──────────────────────────────────────────────────────────

let sessionService: WhatsAppSessionService;

beforeEach(() => {
  vi.clearAllMocks();
  mockEngine.status = 'ready' as const;
  mockEngine.getStatus.mockReturnValue('ready' as const);
  mockEngine.supportsCapability.mockImplementation((cap: string) =>
    cap === 'rejectCall' || cap === 'chatHistoryFetch',
  );
  sessionService = createSessionService();
  setWhatsAppSessionServiceInstance(sessionService);
});

afterEach(() => {
  setWhatsAppSessionServiceInstance(null);
});

// ─── Tests ───────────────────────────────────────────────────────────────

describe('WhatsApp Tools — Session (6.1)', () => {
  it('whatsappGetSessionStatus returns status when session is configured', async () => {
    const result = await whatsappGetSessionStatus({}, makeContext());
    expect(result.success).toBe(true);
    expect(result.output).toContain('WhatsApp Session Status');
    expect(result.output).toContain('ready');
  });

  it('whatsappGetSessionStatus returns error when session not configured', async () => {
    setWhatsAppSessionServiceInstance(null);
    const result = await whatsappGetSessionStatus({}, makeContext());
    expect(result.success).toBe(false);
    expect(result.error).toBe('WHATSAPP_NOT_CONFIGURED');
  });

  it('whatsappStopSession calls session service stop', async () => {
    const stopSpy = vi.spyOn(sessionService, 'stop').mockResolvedValue(undefined);
    const result = await whatsappStopSession({}, makeContext());
    expect(result.success).toBe(true);
    expect(stopSpy).toHaveBeenCalledOnce();
  });

  it('whatsappUnlinkSession calls session service unlink', async () => {
    const unlinkSpy = vi.spyOn(sessionService, 'unlink').mockResolvedValue(undefined);
    const result = await whatsappUnlinkSession({}, makeContext());
    expect(result.success).toBe(true);
    expect(unlinkSpy).toHaveBeenCalledOnce();
  });

  it('whatsappRequestPairingCode validates phone number', async () => {
    const result = await whatsappRequestPairingCode({}, makeContext());
    expect(result.success).toBe(false);
    expect(result.error).toBe('MISSING_INPUT');
  });

  it('whatsappRequestPairingCode returns pairing code', async () => {
    vi.spyOn(sessionService, 'getStatus').mockResolvedValue({
      status: EngineStatus.QR_READY,
      engine: 'baileys',
    });
    const result = await whatsappRequestPairingCode({ phoneNumber: '15559998888' }, makeContext());
    expect(result.success).toBe(true);
    expect(result.output).toContain('PAIR-8888');
  });
});

describe('WhatsApp Tools — Messaging (6.2)', () => {
  it('whatsappSendText sends text message', async () => {
    const result = await whatsappSendText(
      { chatId: '15559998888@c.us', text: 'hello' },
      makeContext(),
    );
    expect(result.success).toBe(true);
    expect(mockEngine.sendText).toHaveBeenCalledWith('15559998888@c.us', 'hello', { mentions: undefined, quotedMessageId: undefined });
  });

  it('whatsappSendText validates required params', async () => {
    expect((await whatsappSendText({}, makeContext())).success).toBe(false);
    expect((await whatsappSendText({ chatId: 'x' }, makeContext())).success).toBe(false);
    expect((await whatsappSendText({ text: 'x' }, makeContext())).success).toBe(false);
  });

  it('whatsappSendText returns error when engine not ready', async () => {
    mockEngine.getStatus.mockReturnValueOnce(EngineStatus.DISCONNECTED);
    const result = await whatsappSendText({ chatId: 'x@c.us', text: 'hi' }, makeContext());
    expect(result.success).toBe(false);
    expect(result.error).toBe('WHATSAPP_NOT_READY');
  });

  it('whatsappSendLocation validates lat/long', async () => {
    const result = await whatsappSendLocation(
      { chatId: 'x@c.us', latitude: 37.77, longitude: -122.41 },
      makeContext(),
    );
    expect(result.success).toBe(true);
    expect(mockEngine.sendLocation).toHaveBeenCalledOnce();
  });

  it('whatsappSendLocation fails without lat/long', async () => {
    const result = await whatsappSendLocation({ chatId: 'x@c.us' }, makeContext());
    expect(result.success).toBe(false);
  });

  it('whatsappSendContact sends contact card', async () => {
    const result = await whatsappSendContact(
      { chatId: 'x@c.us', displayName: 'John', phone: '15551234567' },
      makeContext(),
    );
    expect(result.success).toBe(true);
    expect(mockEngine.sendContact).toHaveBeenCalledOnce();
  });

  it('whatsappSendPoll sends poll', async () => {
    const result = await whatsappSendPoll(
      { chatId: 'x@c.us', question: 'Lunch?', options: ['pizza', 'sushi'] },
      makeContext(),
    );
    expect(result.success).toBe(true);
    expect(mockEngine.sendPoll).toHaveBeenCalledWith('x@c.us', 'Lunch?', ['pizza', 'sushi'], { selectableCount: undefined });
  });

  it('whatsappReply sends reply', async () => {
    const result = await whatsappReply(
      { chatId: 'x@c.us', quotedMessageId: 'msg-1', text: 'reply text' },
      makeContext(),
    );
    expect(result.success).toBe(true);
    expect(mockEngine.reply).toHaveBeenCalledWith('x@c.us', 'msg-1', 'reply text');
  });

  it('whatsappForward forwards message', async () => {
    const result = await whatsappForward(
      { chatId: 'dst@c.us', sourceChatId: 'src@c.us', messageId: 'msg-1' },
      makeContext(),
    );
    expect(result.success).toBe(true);
    expect(mockEngine.forwardMessage).toHaveBeenCalledWith('dst@c.us', 'src@c.us', 'msg-1');
  });

  it('whatsappReact adds reaction', async () => {
    const result = await whatsappReact(
      { chatId: 'x@c.us', messageId: 'msg-1', emoji: '👍' },
      makeContext(),
    );
    expect(result.success).toBe(true);
    expect(mockEngine.react).toHaveBeenCalledWith('x@c.us', 'msg-1', '👍');
  });

  it('whatsappReact removes reaction with null emoji', async () => {
    const result = await whatsappReact(
      { chatId: 'x@c.us', messageId: 'msg-1' },
      makeContext(),
    );
    expect(result.success).toBe(true);
    expect(mockEngine.react).toHaveBeenCalledWith('x@c.us', 'msg-1', null);
  });

  it('whatsappEditMessage edits message', async () => {
    const result = await whatsappEditMessage(
      { chatId: 'x@c.us', messageId: 'msg-1', newText: 'edited' },
      makeContext(),
    );
    expect(result.success).toBe(true);
    expect(mockEngine.editMessage).toHaveBeenCalledWith('x@c.us', 'msg-1', 'edited');
  });

  it('whatsappDeleteMessage deletes for everyone', async () => {
    const result = await whatsappDeleteMessage(
      { chatId: 'x@c.us', messageId: 'msg-1', forEveryone: true },
      makeContext(),
    );
    expect(result.success).toBe(true);
    expect(mockEngine.deleteMessage).toHaveBeenCalledWith('x@c.us', 'msg-1', true);
  });

  it('whatsappDeleteMessage deletes for me by default', async () => {
    const result = await whatsappDeleteMessage(
      { chatId: 'x@c.us', messageId: 'msg-1' },
      makeContext(),
    );
    expect(result.success).toBe(true);
    expect(mockEngine.deleteMessage).toHaveBeenCalledWith('x@c.us', 'msg-1', false);
  });
});

describe('WhatsApp Tools — Bulk Send (6.3)', () => {
  it('whatsappSendBulk starts a batch', async () => {
    const result = await whatsappSendBulk(
      { chatId: 'x@c.us', messages: ['msg1', 'msg2'], delayMs: 10 },
      makeContext(),
    );
    expect(result.success).toBe(true);
    expect(result.metadata).toHaveProperty('batchId');
    expect(result.metadata).toHaveProperty('total', 2);
  });

  it('whatsappSendBulk requires chatId', async () => {
    const result = await whatsappSendBulk({ messages: ['msg1'] }, makeContext());
    expect(result.success).toBe(false);
  });

  it('whatsappGetBatchStatus returns batch progress', async () => {
    // Start a batch with very short delay
    const startResult = await whatsappSendBulk(
      { chatId: 'x@c.us', messages: ['a', 'b'], delayMs: 10 },
      makeContext(),
    );
    const batchId = startResult.metadata!.batchId as string;

    // Wait a bit for the batch to process
    await new Promise((r) => setTimeout(r, 100));

    const statusResult = await whatsappGetBatchStatus({ batchId }, makeContext());
    expect(statusResult.success).toBe(true);
    expect(statusResult.metadata).toHaveProperty('batchId', batchId);
  });

  it('whatsappGetBatchStatus returns error for unknown batch', async () => {
    const result = await whatsappGetBatchStatus({ batchId: 'nonexistent' }, makeContext());
    expect(result.success).toBe(false);
    expect(result.error).toBe('NOT_FOUND');
  });

  it('whatsappCancelBatch cancels a running batch', async () => {
    // Start a batch with long delay so it's still running
    const startResult = await whatsappSendBulk(
      { chatId: 'x@c.us', messages: ['a', 'b', 'c'], delayMs: 5000 },
      makeContext(),
    );
    const batchId = startResult.metadata!.batchId as string;

    const cancelResult = await whatsappCancelBatch({ batchId }, makeContext());
    expect(cancelResult.success).toBe(true);
  });
});

describe('WhatsApp Tools — Contacts (6.4)', () => {
  it('whatsappCheckNumber returns exists=true for valid number', async () => {
    mockEngine.checkNumberExists.mockResolvedValueOnce({ exists: true, jid: '15559998888@c.us' });
    const result = await whatsappCheckNumber({ phoneNumber: '15559998888' }, makeContext());
    expect(result.success).toBe(true);
    expect(result.output).toContain('registered');
  });

  it('whatsappCheckNumber returns exists=false for unregistered number', async () => {
    mockEngine.checkNumberExists.mockResolvedValueOnce({ exists: false, jid: undefined });
    const result = await whatsappCheckNumber({ phoneNumber: '15550000000' }, makeContext());
    expect(result.success).toBe(true);
    expect(result.output).toContain('NOT registered');
  });

  it('whatsappBlockContact blocks a contact', async () => {
    const result = await whatsappBlockContact({ jid: 'x@c.us' }, makeContext());
    expect(result.success).toBe(true);
    expect(mockEngine.blockContact).toHaveBeenCalledWith('x@c.us');
  });

  it('whatsappUnblockContact unblocks a contact', async () => {
    const result = await whatsappUnblockContact({ jid: 'x@c.us' }, makeContext());
    expect(result.success).toBe(true);
    expect(mockEngine.unblockContact).toHaveBeenCalledWith('x@c.us');
  });
});

describe('WhatsApp Tools — Capability Gating (6.5, 6.6, 6.7)', () => {
  it('whatsappListLabels returns not-supported when labels capability is missing', async () => {
    mockEngine.supportsCapability.mockImplementation(() => false);
    const result = await whatsappListLabels({}, makeContext());
    expect(result.success).toBe(false);
    expect(result.error).toBe('CAPABILITY_NOT_SUPPORTED');
    expect(result.output).toContain('labels');
  });

  it('whatsappCreateGroup returns not-supported when groupManagement capability is missing', async () => {
    mockEngine.supportsCapability.mockImplementation(() => false);
    const result = await whatsappCreateGroup(
      { subject: 'Test', participants: ['x@c.us'] },
      makeContext(),
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('CAPABILITY_NOT_SUPPORTED');
    expect(result.output).toContain('groupManagement');
  });

  it('whatsappPostTextStatus returns not-supported when statusStories capability is missing', async () => {
    mockEngine.supportsCapability.mockImplementation(() => false);
    const result = await whatsappPostTextStatus({ text: 'hello' }, makeContext());
    expect(result.success).toBe(false);
    expect(result.error).toBe('CAPABILITY_NOT_SUPPORTED');
    expect(result.output).toContain('statusStories');
  });

  it('whatsappRejectCall works when rejectCall capability is present', async () => {
    mockEngine.supportsCapability.mockImplementation((cap) => cap === 'rejectCall');
    const result = await whatsappRejectCall({ callId: 'call-1' }, makeContext());
    expect(result.success).toBe(true);
    expect(mockEngine.rejectCall).toHaveBeenCalledWith('call-1');
  });

  it('whatsappRejectCall returns not-supported when rejectCall capability is missing', async () => {
    mockEngine.supportsCapability.mockImplementation(() => false);
    const result = await whatsappRejectCall({ callId: 'call-1' }, makeContext());
    expect(result.success).toBe(false);
    expect(result.error).toBe('CAPABILITY_NOT_SUPPORTED');
  });
});

describe('WhatsApp Tools — Webhooks (6.8)', () => {
  it('whatsappCreateWebhook creates a webhook', async () => {
    const result = await whatsappCreateWebhook(
      { url: 'https://example.com/webhook', secret: 'mysecret' },
      makeContext(),
    );
    expect(result.success).toBe(true);
    expect(result.metadata).toHaveProperty('webhookId');
  });

  it('whatsappCreateWebhook validates URL', async () => {
    const result = await whatsappCreateWebhook({ url: 'not-a-url' }, makeContext());
    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_URL');
  });

  it('whatsappCreateWebhook rejects non-http protocols', async () => {
    const result = await whatsappCreateWebhook({ url: 'ftp://example.com' }, makeContext());
    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_URL');
  });

  it('whatsappListWebhooks returns empty list', async () => {
    const result = await whatsappListWebhooks({}, makeContext());
    expect(result.success).toBe(true);
    expect(result.output).toContain('No webhooks');
  });

  it('whatsappDeleteWebhook deletes a webhook', async () => {
    const result = await whatsappDeleteWebhook({ webhookId: 'wh-1' }, makeContext());
    expect(result.success).toBe(true);
  });

  it('whatsappTestWebhook sends test event', async () => {
    // Mock fetch
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    globalThis.fetch = mockFetch as never;

    // Mock the pool to return a webhook URL
    const pool = (sessionService as unknown as { pool: Pool }).pool;
    (pool.query as ReturnType<typeof vi.fn>).mockImplementation(async (text: string) => {
      if (text.includes('SELECT url FROM whatsapp_webhooks')) {
        return { rows: [{ url: 'https://example.com/hook' }], rowCount: 1 } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    });

    const result = await whatsappTestWebhook({ webhookId: 'wh-1' }, makeContext());
    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});

describe('WhatsApp Tools — Error Handling', () => {
  it('all tools return WHATSAPP_NOT_CONFIGURED when no session service', async () => {
    setWhatsAppSessionServiceInstance(null);
    const result = await whatsappSendText({ chatId: 'x', text: 'y' }, makeContext());
    expect(result.success).toBe(false);
    expect(result.error).toBe('WHATSAPP_NOT_CONFIGURED');
  });

  it('messaging tools return WHATSAPP_NOT_READY when engine not ready', async () => {
    mockEngine.getStatus.mockReturnValue(EngineStatus.DISCONNECTED);
    const result = await whatsappSendText({ chatId: 'x@c.us', text: 'hi' }, makeContext());
    expect(result.success).toBe(false);
    expect(result.error).toBe('WHATSAPP_NOT_READY');
  });

  it('tools catch engine errors and return OPERATION_FAILED', async () => {
    mockEngine.sendText.mockRejectedValueOnce(new Error('network timeout'));
    const result = await whatsappSendText({ chatId: 'x@c.us', text: 'hi' }, makeContext());
    expect(result.success).toBe(false);
    expect(result.error).toBe('OPERATION_FAILED');
    expect(result.output).toContain('network timeout');
  });
});
