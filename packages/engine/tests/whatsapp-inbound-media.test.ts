import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { WhatsAppIncomingMessage } from '../src/whatsapp/engine/IWhatsAppEngine.js';

const registerAttachment = vi.fn();

vi.mock('../src/attachments/index.js', () => ({
  getAttachmentService: () => ({
    registerAttachment: (...args: unknown[]) => registerAttachment(...args),
  }),
}));

import { WhatsAppSessionService } from '../src/whatsapp/WhatsAppSessionService.js';

function inbound(overrides: Partial<WhatsAppIncomingMessage> = {}): WhatsAppIncomingMessage {
  return {
    id: 'wa-media-1',
    chatId: '15559998888@c.us',
    from: '15559998888@c.us',
    to: '15551234567@c.us',
    fromMe: false,
    isGroup: false,
    type: 'image',
    body: 'beach',
    timestamp: 1,
    raw: {},
    pushName: 'Priya',
    ...overrides,
  };
}

describe('WhatsApp inbound media persist', () => {
  let query: ReturnType<typeof vi.fn>;
  let service: WhatsAppSessionService;

  beforeEach(() => {
    registerAttachment.mockReset();
    registerAttachment.mockResolvedValue({ id: 'att-wa-1' });
    query = vi.fn(async () => ({ rows: [] }));
    service = new WhatsAppSessionService({
      pool: { query } as unknown as Pool,
      dek: Buffer.alloc(32),
    });
  });

  it('registers inbound media on the voice attachment session and stores storageId in metadata', async () => {
    const msg = inbound({
      media: {
        mimetype: 'image/jpeg',
        data: Buffer.from('fake-jpeg').toString('base64'),
        fileName: 'beach.jpg',
        caption: 'beach',
      },
    });

    await service.persistInboundMessage(msg);

    expect(registerAttachment).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: '__channel__:voice',
      source: 'whatsapp',
      filename: 'beach.jpg',
      mimeType: 'image/jpeg',
    }));
    expect(msg.attachmentId).toBe('att-wa-1');

    const insert = query.mock.calls.find((call) => String(call[0]).includes('INSERT INTO whatsapp_messages'));
    expect(insert).toBeTruthy();
    const params = insert?.[1] as unknown[];
    expect(params[3]).toBe('inbound');
    const metadata = JSON.parse(String(params[10]));
    expect(metadata.storageId).toBe('att-wa-1');
    expect(metadata.mediaMime).toBe('image/jpeg');
    expect(metadata.actor).toBe('contact');
  });

  it('persists owner and Agent-X outbound sends with actor metadata', async () => {
    await service.persistWhatsAppMessage(inbound({
      id: 'wa-owner-out',
      fromMe: true,
      type: 'text',
      body: 'On my way',
    }));
    await service.persistWhatsAppMessage(inbound({
      id: 'wa-agent-out',
      fromMe: true,
      type: 'text',
      body: '[Agent-X]\nCalendar is clear this afternoon.',
    }));

    const ownerInsert = query.mock.calls.find((call) =>
      String(call[0]).includes('INSERT INTO whatsapp_messages')
      && (call[1] as unknown[])[1] === 'wa-owner-out',
    );
    const agentInsert = query.mock.calls.find((call) =>
      String(call[0]).includes('INSERT INTO whatsapp_messages')
      && (call[1] as unknown[])[1] === 'wa-agent-out',
    );
    expect((ownerInsert?.[1] as unknown[])[3]).toBe('outbound');
    expect(JSON.parse(String((ownerInsert?.[1] as unknown[])[10])).actor).toBe('owner');
    expect((agentInsert?.[1] as unknown[])[3]).toBe('outbound');
    expect(JSON.parse(String((agentInsert?.[1] as unknown[])[10])).actor).toBe('agent');
  });

  it('lists persisted messages from the database for later agent fetch', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        waMessageId: 'wa-1',
        chatId: '15559998888@c.us',
        direction: 'inbound',
        from: '15559998888@c.us',
        to: '15551234567@c.us',
        body: 'hello',
        type: 'text',
        timestamp: 1_700_000_000,
        metadata: { actor: 'contact', pushName: 'Priya' },
      }],
    });
    const rows = await service.listPersistedMessages({ query: 'hello', limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata.actor).toBe('contact');
    expect(String(query.mock.calls.at(-1)?.[0])).toContain('FROM whatsapp_messages');
  });

  it('skips omitted or oversize media and still persists the text row', async () => {
    const omitted = inbound({
      id: 'wa-omit',
      media: { mimetype: 'video/mp4', omitted: true, sizeBytes: 20_000_000 },
    });
    await service.persistInboundMessage(omitted);
    expect(registerAttachment).not.toHaveBeenCalled();
    expect(omitted.attachmentId).toBeUndefined();

    registerAttachment.mockRejectedValueOnce(new Error('File too large (max 10MB)'));
    const oversize = inbound({
      id: 'wa-big',
      media: {
        mimetype: 'video/mp4',
        data: Buffer.from('big').toString('base64'),
        fileName: 'clip.mp4',
      },
    });
    await service.persistInboundMessage(oversize);
    expect(oversize.attachmentId).toBeUndefined();
    const insert = query.mock.calls.find((call) =>
      String(call[0]).includes('INSERT INTO whatsapp_messages')
      && (call[1] as unknown[])[1] === 'wa-big',
    );
    const metadata = JSON.parse(String((insert?.[1] as unknown[])[10]));
    expect(metadata.storageId).toBeUndefined();
  });
});
