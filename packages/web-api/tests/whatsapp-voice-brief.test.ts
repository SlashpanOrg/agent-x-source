import { describe, expect, it } from 'vitest';
import {
  formatWhatsAppVoiceBriefInstruction,
  parseWhatsAppVoiceBriefFromContext,
  peekWhatsAppVoiceBrief,
  setWhatsAppVoiceBrief,
} from '../src/whatsapp-voice-brief.js';

describe('whatsapp voice brief', () => {
  it('stores the latest world brief for the next voice turn', () => {
    setWhatsAppVoiceBrief({
      who: 'Priya',
      text: 'Are you free tonight?',
      senderJid: '15559998888@c.us',
      chatId: '15559998888@c.us',
      isGroup: false,
    });
    const brief = peekWhatsAppVoiceBrief();
    expect(brief?.who).toBe('Priya');
    const instruction = formatWhatsAppVoiceBriefInstruction(brief!);
    expect(instruction).toContain('[WHATSAPP_PENDING_BRIEF]');
    expect(instruction).toContain('Are you free tonight?');
    expect(instruction).toContain('whatsapp_send_text');
    expect(instruction).toContain('whatsapp_react');
    expect(instruction).toContain('No visual media is attached.');
  });

  it('includes media refs and parses them back from the announce context', () => {
    setWhatsAppVoiceBrief({
      who: 'Priya',
      text: 'Look at this',
      senderJid: '15559998888@c.us',
      chatId: '15559998888@c.us',
      isGroup: false,
      mediaStorageId: 'att-wa-1',
      mediaKind: 'image',
    });
    const instruction = formatWhatsAppVoiceBriefInstruction(peekWhatsAppVoiceBrief()!);
    expect(instruction).toContain('att-wa-1');
    expect(instruction).toContain('visual stage');

    const parsed = parseWhatsAppVoiceBriefFromContext([
      '[WHATSAPP_PENDING_BRIEF]',
      'Sender: Priya',
      'JID: 15559998888@c.us',
      'Chat: 15559998888@c.us',
      'Group: no',
      'Text: Look at this',
      'Media-Storage-Id: att-wa-1',
      'Media-Kind: image',
      'Media-Mime: image/jpeg',
      'Media-Caption: beach',
      'Media-Title: Message from Priya',
      'The owner was just told about this WhatsApp message over voice.',
      '[/WHATSAPP_PENDING_BRIEF]',
    ].join('\n'));
    expect(parsed).toMatchObject({
      who: 'Priya',
      text: 'Look at this',
      mediaStorageId: 'att-wa-1',
      mediaKind: 'image',
      mediaCaption: 'beach',
    });
  });
});
