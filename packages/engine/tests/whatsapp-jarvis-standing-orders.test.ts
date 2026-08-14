import { describe, expect, it } from 'vitest';
import { matchStandingOrder, scoreStandingOrder } from '../src/whatsapp/jarvis/matchStandingOrder.js';
import type { StandingOrder, WorldEvent } from '../src/whatsapp/jarvis/standing-order-types.js';

function order(partial: Partial<StandingOrder> & Pick<StandingOrder, 'id' | 'title' | 'match' | 'action'>): StandingOrder {
  return {
    enabled: true,
    priority: 0,
    createdFrom: 'desktop',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

const schoolDm: WorldEvent = {
  senderJid: '15551112222@c.us',
  chatId: '15551112222@c.us',
  text: 'Pickup is at 3pm today',
  isGroup: false,
};

describe('matchStandingOrder', () => {
  it('returns null when nothing matches so the router can default to brief', () => {
    expect(matchStandingOrder([], schoolDm)).toBeNull();
  });

  it('prefers an exact sender JID over a keyword catch', () => {
    const keyword = order({
      id: 'kw',
      title: 'Pickup keyword',
      match: { keywords: ['pickup'] },
      action: { type: 'brief' },
    });
    const sender = order({
      id: 'school',
      title: 'School pickup',
      match: { senders: ['15551112222@s.whatsapp.net'] },
      action: { type: 'auto_reply', replyTemplate: "I'll pick up" },
    });
    const hit = matchStandingOrder([keyword, sender], schoolDm);
    expect(hit?.id).toBe('school');
    expect(hit?.action.type).toBe('auto_reply');
  });

  it('normalizes sender JIDs to @c.us when scoring', () => {
    const o = order({
      id: 'n',
      title: 'Neutral',
      match: { senders: ['15551112222@s.whatsapp.net'] },
      action: { type: 'ignore' },
    });
    expect(scoreStandingOrder(o, schoolDm)).toBeGreaterThanOrEqual(100);
  });

  it('does not apply a DM-only order to a group', () => {
    const o = order({
      id: 'dm',
      title: 'DMs only',
      match: { senders: ['15551112222@c.us'], chatKind: 'dm' },
      action: { type: 'auto_reply', replyTemplate: 'ok' },
    });
    const group: WorldEvent = { ...schoolDm, chatId: '120363@g.us', isGroup: true };
    expect(scoreStandingOrder(o, group)).toBe(0);
    expect(matchStandingOrder([o], group)).toBeNull();
  });

  it('matches group id with high specificity', () => {
    const o = order({
      id: 'g',
      title: 'Family group',
      match: { groups: ['120363@g.us'] },
      action: { type: 'ignore' },
    });
    const group: WorldEvent = {
      senderJid: '15551112222@c.us',
      chatId: '120363@g.us',
      text: 'hello',
      isGroup: true,
    };
    expect(matchStandingOrder([o], group)?.id).toBe('g');
  });

  it('skips disabled orders', () => {
    const o = order({
      id: 'off',
      title: 'Off',
      enabled: false,
      match: { senders: ['15551112222@c.us'] },
      action: { type: 'ignore' },
    });
    expect(matchStandingOrder([o], schoolDm)).toBeNull();
  });
});
