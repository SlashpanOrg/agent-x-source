import { describe, expect, it } from 'vitest';
import { classifyWhatsAppInbound } from '../src/whatsapp/jarvis/classifyInbound.js';
import { AGENT_X_WHATSAPP_MARKER } from '../src/whatsapp/jarvis/constants.js';
import type { WhatsAppIncomingMessage } from '../src/whatsapp/engine/IWhatsAppEngine.js';

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
    body: 'hello',
    timestamp: 1,
    raw: {},
    ...overrides,
  };
}

const ctx = { ownerJids: [OWNER] };

describe('classifyWhatsAppInbound', () => {
  it('treats unmarked self-chat fromMe as an owner command', () => {
    const result = classifyWhatsAppInbound(msg({
      chatId: OWNER,
      from: OWNER,
      fromMe: true,
      body: 'tell Mom I will be late',
    }), ctx);
    expect(result).toMatchObject({ kind: 'owner_command', text: 'tell Mom I will be late', chatId: OWNER });
  });

  it('treats unmarked self-chat not-fromMe as an owner command', () => {
    const result = classifyWhatsAppInbound(msg({
      chatId: OWNER,
      from: OWNER,
      fromMe: false,
      body: 'list standing orders',
    }), ctx);
    expect(result.kind).toBe('owner_command');
  });

  it('drops agent-marked self-chat echoes', () => {
    const result = classifyWhatsAppInbound(msg({
      chatId: OWNER,
      from: OWNER,
      fromMe: true,
      body: `${AGENT_X_WHATSAPP_MARKER}\nMessage from Priya`,
    }), ctx);
    expect(result).toMatchObject({ kind: 'ignore', reason: 'agent self-chat echo' });
  });

  it('drops echoes of recent outbound ids', () => {
    const result = classifyWhatsAppInbound(msg({
      id: 'out-9',
      chatId: OWNER,
      fromMe: true,
      body: 'plain echo without marker',
    }), { ownerJids: [OWNER], recentOutboundIds: ['out-9'] });
    expect(result).toMatchObject({ kind: 'ignore', reason: 'echo of our outbound message' });
  });

  it('ignores owner talking to the world (fromMe other chat)', () => {
    const result = classifyWhatsAppInbound(msg({
      chatId: '15559998888@c.us',
      fromMe: true,
      body: 'on my way',
    }), ctx);
    expect(result).toMatchObject({ kind: 'ignore', reason: 'owner talking to the world' });
  });

  it('classifies a world DM', () => {
    const result = classifyWhatsAppInbound(msg({
      chatId: '15559998888@c.us',
      from: '15559998888@s.whatsapp.net',
      body: 'Are you coming Sunday?',
      pushName: 'Priya',
    }), ctx);
    expect(result).toEqual({
      kind: 'world',
      senderJid: '15559998888@c.us',
      chatId: '15559998888@c.us',
      text: 'Are you coming Sunday?',
      isGroup: false,
      senderName: 'Priya',
      messageId: 'm1',
    });
  });

  it('classifies a group message as world', () => {
    const result = classifyWhatsAppInbound(msg({
      chatId: '120363@g.us',
      from: '120363@g.us',
      author: '15559998888@c.us',
      isGroup: true,
      body: 'who is bringing drinks?',
    }), ctx);
    expect(result).toMatchObject({
      kind: 'world',
      senderJid: '15559998888@c.us',
      chatId: '120363@g.us',
      isGroup: true,
    });
  });

  it('ignores status and newsletter chats', () => {
    expect(classifyWhatsAppInbound(msg({ chatId: 'status@broadcast', from: 'status@broadcast' }), ctx).kind).toBe('ignore');
    expect(classifyWhatsAppInbound(msg({ chatId: '123@newsletter', from: '123@newsletter' }), ctx).kind).toBe('ignore');
  });
});
