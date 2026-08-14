import { afterEach, describe, expect, it } from 'vitest';
import { parseVisualItem } from '@agentx/shared';
import {
  emitVisualPresent,
  maybePresentWhatsAppVisual,
  setVisualPresentEmitter,
} from '../src/visual-present.js';
import { clearWhatsAppVoiceBrief, setWhatsAppVoiceBrief } from '../src/whatsapp-voice-brief.js';
import { userWantsWhatsAppVisual } from '../src/voice-speakable.js';

describe('userWantsWhatsAppVisual', () => {
  it('matches yes / show / read that', () => {
    expect(userWantsWhatsAppVisual('yes')).toBe(true);
    expect(userWantsWhatsAppVisual('show me')).toBe(true);
    expect(userWantsWhatsAppVisual('read that')).toBe(true);
    expect(userWantsWhatsAppVisual('what did they send')).toBe(true);
    expect(userWantsWhatsAppVisual('no thanks')).toBe(false);
    expect(userWantsWhatsAppVisual('tell them I am busy tonight')).toBe(false);
  });
});

describe('maybePresentWhatsAppVisual', () => {
  const presented: unknown[] = [];

  afterEach(() => {
    presented.length = 0;
    setVisualPresentEmitter(null);
    clearWhatsAppVoiceBrief();
  });

  it('emits a visual_present-shaped item when the brief has media and the owner affirms', () => {
    setVisualPresentEmitter((item) => { presented.push(item); });
    setWhatsAppVoiceBrief({
      who: 'Priya',
      text: 'Look at this',
      senderJid: '15559998888@c.us',
      chatId: '15559998888@c.us',
      isGroup: false,
      mediaStorageId: 'att-wa-1',
      mediaKind: 'image',
      mediaMime: 'image/jpeg',
      mediaCaption: 'beach',
      mediaTitle: 'Message from Priya',
    });

    expect(maybePresentWhatsAppVisual('yes please')).toBe(true);
    expect(presented).toHaveLength(1);
    const item = parseVisualItem(presented[0]);
    expect(item).toMatchObject({
      kind: 'image',
      title: 'Message from Priya',
      source: { storageId: 'att-wa-1' },
      attribution: 'WhatsApp · Priya',
    });
    expect({ type: 'visual_present', item }).toMatchObject({
      type: 'visual_present',
      item: expect.objectContaining({ kind: 'image' }),
    });
  });

  it('does not present text-only briefs or non-affirming replies', () => {
    setVisualPresentEmitter((item) => { presented.push(item); });
    setWhatsAppVoiceBrief({
      who: 'Priya',
      text: 'Are you free tonight?',
      senderJid: '15559998888@c.us',
      chatId: '15559998888@c.us',
      isGroup: false,
    });
    expect(maybePresentWhatsAppVisual('yes')).toBe(false);
    expect(maybePresentWhatsAppVisual('show me')).toBe(false);

    setWhatsAppVoiceBrief({
      who: 'Priya',
      text: 'Look',
      senderJid: '15559998888@c.us',
      chatId: '15559998888@c.us',
      isGroup: false,
      mediaStorageId: 'att-wa-1',
      mediaKind: 'image',
    });
    expect(maybePresentWhatsAppVisual('tell them later')).toBe(false);
    expect(presented).toHaveLength(0);
  });

  it('emitVisualPresent is a no-op without an emitter', () => {
    setVisualPresentEmitter(null);
    expect(() => emitVisualPresent({
      id: 'v1',
      kind: 'url',
      title: 'Docs',
      source: { url: 'https://example.com' },
    })).not.toThrow();
  });
});
