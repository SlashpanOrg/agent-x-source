import { describe, expect, it, vi } from 'vitest';
import type { WhatsAppIncomingMessage } from '../src/whatsapp/engine/IWhatsAppEngine.js';
import type { WhatsAppSessionService } from '../src/whatsapp/WhatsAppSessionService.js';
import { WhatsAppJarvisRouter } from '../src/whatsapp/jarvis/WhatsAppJarvisRouter.js';
import type { StandingOrderStore } from '../src/whatsapp/jarvis/StandingOrderStore.js';

const OWNER = '15551234567@c.us';

function msg(overrides: Partial<WhatsAppIncomingMessage> = {}): WhatsAppIncomingMessage {
  return {
    id: 'm1',
    chatId: '15559998888@c.us',
    from: '15559998888@c.us',
    to: OWNER,
    fromMe: false,
    isGroup: false,
    type: 'text',
    body: 'Are you free tonight?',
    timestamp: 1,
    raw: {},
    pushName: 'Priya',
    ...overrides,
  };
}

function createRouter(hooks: {
  announceVoice?: ReturnType<typeof vi.fn>;
  publishNotification?: ReturnType<typeof vi.fn>;
  ensureOwnerAgent?: ReturnType<typeof vi.fn>;
  sendText?: ReturnType<typeof vi.fn>;
}) {
  const sendText = hooks.sendText ?? vi.fn(async () => ({ messageId: 'out-1', timestamp: 1 }));
  const sessionService = {
    getOwnerJids: () => [OWNER],
    getRecentOutboundIds: () => [],
    persistInboundMessage: vi.fn(async () => {}),
    getSelfChatId: () => OWNER,
    getEngine: () => ({ sendText }),
    rememberOutboundId: vi.fn(),
    rememberSelfChatId: vi.fn(),
  } as unknown as WhatsAppSessionService;

  return {
    router: new WhatsAppJarvisRouter({
      sessionService,
      standingOrders: { list: async () => [] } as unknown as StandingOrderStore,
      ensureOwnerAgent: hooks.ensureOwnerAgent ?? vi.fn(async () => null),
      publishNotification: hooks.publishNotification ?? vi.fn(async () => {}),
      announceVoice: hooks.announceVoice ?? vi.fn(async () => {}),
    }),
    sendText,
  };
}

describe('WhatsAppJarvisRouter', () => {
  it('asks the owner over voice whether to read a world message and still notifies', async () => {
    const announceVoice = vi.fn(async () => {});
    const publishNotification = vi.fn(async () => {});
    const { router, sendText } = createRouter({ announceVoice, publishNotification });

    await router.handleIncoming(msg());

    expect(publishNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: 'WhatsApp · Priya',
      body: 'Are you free tonight?',
    }));
    expect(announceVoice).toHaveBeenCalledTimes(1);
    const [line, context] = announceVoice.mock.calls[0] as [string, string];
    expect(line).toBe('Sir, there is a message from Priya. Would you like me to read that?');
    expect(context).toContain('Are you free tonight?');
    expect(context).toContain('whatsapp_send_text');
    expect(context).toContain('whatsapp_react');
    expect(sendText).toHaveBeenCalled();
    expect(context).not.toContain('Media-Storage-Id');
  });

  it('puts persisted media refs on the voice brief context', async () => {
    const announceVoice = vi.fn(async () => {});
    const { router } = createRouter({ announceVoice });

    await router.handleIncoming(msg({
      type: 'image',
      body: 'beach',
      attachmentId: 'att-wa-1',
      media: {
        mimetype: 'image/jpeg',
        caption: 'beach',
        data: 'abc',
      },
    }));

    expect(announceVoice).toHaveBeenCalledTimes(1);
    const [, context] = announceVoice.mock.calls[0] as [string, string];
    expect(context).toContain('Media-Storage-Id: att-wa-1');
    expect(context).toContain('Media-Kind: image');
    expect(context).toContain('Media-Caption: beach');
  });

  it('tells the voice brief when inbound media could not be stored', async () => {
    const announceVoice = vi.fn(async () => {});
    const { router } = createRouter({ announceVoice });

    await router.handleIncoming(msg({
      type: 'video',
      body: '',
      media: { mimetype: 'video/mp4', omitted: true, sizeBytes: 20_000_000 },
    }));

    const [, context] = announceVoice.mock.calls[0] as [string, string];
    expect(context).toContain('Media-Omitted');
    expect(context).not.toContain('Media-Storage-Id');
  });

  it('routes unmarked self-chat to the owner agent', async () => {
    const sendMessage = vi.fn(async () => ({ content: 'You are free after 3pm.' }));
    const ensureOwnerAgent = vi.fn(async () => ({ sendMessage }));
    const { router, sendText } = createRouter({ ensureOwnerAgent });

    await router.handleIncoming(msg({
      id: 'self-1',
      chatId: OWNER,
      from: OWNER,
      to: OWNER,
      fromMe: true,
      body: 'what is on my calendar',
      pushName: undefined,
    }));

    expect(ensureOwnerAgent).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(
      'what is on my calendar',
      expect.objectContaining({
        sourceChannel: 'whatsapp',
        sourceMessageId: 'self-1',
        channelId: OWNER,
      }),
    );
    expect(sendText).toHaveBeenCalledWith(
      OWNER,
      expect.stringContaining('[Agent-X]'),
      expect.anything(),
    );
    expect(sendText).toHaveBeenCalledWith(
      OWNER,
      expect.stringContaining('You are free after 3pm.'),
      expect.anything(),
    );
  });

  it('still replies on WhatsApp when the owner agent throws', async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error('invalid input syntax for type bigint: "NaN"');
    });
    const ensureOwnerAgent = vi.fn(async () => ({ sendMessage }));
    const { router, sendText } = createRouter({ ensureOwnerAgent });

    await router.handleIncoming(msg({
      id: 'self-err',
      chatId: OWNER,
      from: OWNER,
      to: OWNER,
      fromMe: true,
      body: 'ping',
    }));

    expect(sendText).toHaveBeenCalledWith(
      OWNER,
      expect.stringContaining('I hit an error processing that'),
      expect.anything(),
    );
  });

  it('sends live fillers from engine events then the answer', async () => {
    const listeners: Array<(ev: unknown) => void> = [];
    const sendMessage = vi.fn(async () => {
      for (const h of listeners) {
        h({ type: 'tool_executing', tool: 'web_search', description: 'spot price', startTime: 1 });
        h({ type: 'tool_executing', tool: 'knowledge_base_search', description: 'notes', startTime: 1 });
      }
      return { content: 'Spot gold is $2,400.' };
    });
    const ensureOwnerAgent = vi.fn(async () => ({
      sendMessage,
      config: { user: { callsign: 'Mitra' } },
      events: {
        on: (h: (ev: unknown) => void) => {
          listeners.push(h);
          return () => {};
        },
      },
    }));
    const { router, sendText } = createRouter({ ensureOwnerAgent });

    await router.handleIncoming(msg({
      id: 'self-gold',
      chatId: OWNER,
      from: OWNER,
      to: OWNER,
      fromMe: true,
      body: 'what is the gold rate',
    }));

    const bodies = sendText.mock.calls.map((c) => String(c[1]));
    expect(bodies.some((b) => b.includes('Checking, Mitra.'))).toBe(true);
    expect(bodies.some((b) => b.includes('Browsing the internet.'))).toBe(true);
    expect(bodies.some((b) => b.includes('Accessing the knowledge base.'))).toBe(true);
    expect(bodies.some((b) => b.includes('Spot gold is $2,400.'))).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(
      'what is the gold rate',
      expect.objectContaining({ sourceChannel: 'whatsapp' }),
    );
  });

  it('accepts a clarification reply while the turn is still running', async () => {
    let resolveTurn: (value: unknown) => void = () => {};
    const turn = new Promise((resolve) => {
      resolveTurn = resolve;
    });
    const listeners: Array<(ev: unknown) => void> = [];
    const respondToClarification = vi.fn((text: string) => {
      resolveTurn({ content: `Noted: ${text}` });
      return true;
    });
    const sendMessage = vi.fn(async () => {
      for (const h of listeners) {
        h({
          type: 'clarification_required',
          questionnaire: {
            id: 'q1',
            questions: [{ id: 'city', prompt: 'Which city?', type: 'text' }],
          },
        });
      }
      return turn;
    });
    const ensureOwnerAgent = vi.fn(async () => ({
      sendMessage,
      respondToClarification,
      isAwaitingClarification: () => true,
      config: { user: { callsign: 'Mitra' } },
      events: {
        on: (h: (ev: unknown) => void) => {
          listeners.push(h);
          return () => {};
        },
      },
    }));
    const { router, sendText } = createRouter({ ensureOwnerAgent });

    const first = router.handleIncoming(msg({
      id: 'self-q',
      chatId: OWNER,
      from: OWNER,
      to: OWNER,
      fromMe: true,
      body: 'gold rate',
    }));

    await vi.waitFor(() => {
      expect(sendText.mock.calls.some((c) => String(c[1]).includes('Which city?'))).toBe(true);
    });

    await router.handleIncoming(msg({
      id: 'self-a',
      chatId: OWNER,
      from: OWNER,
      to: OWNER,
      fromMe: true,
      body: 'Mumbai',
    }));

    expect(respondToClarification).toHaveBeenCalledWith('Mumbai');
    await first;
    const bodies = sendText.mock.calls.map((c) => String(c[1]));
    expect(bodies.some((b) => b.includes('Got it — continuing.'))).toBe(true);
    expect(bodies.some((b) => b.includes('Noted: Mumbai'))).toBe(true);
  });
});
