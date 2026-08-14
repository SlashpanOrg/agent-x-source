/**
 * WhatsApp JID normalization + message mapper tests (Phase 4.6).
 *
 * Tests cover:
 *   - JID parsing and normalization (wa-id.ts)
 *   - chatKind() classification (individual/group/channel/status/broadcast/unknown)
 *   - Device-suffix stripping
 *   - Baileys message mapper (text/image/video/audio/document/sticker/location)
 *   - WWebJS message mapper
 */
import { describe, it, expect } from 'vitest';
import {
  parseWaId,
  toNeutralJid,
  toBaileysJid,
  chatKind,
  isLidJid,
  phoneFromNeutralJid,
  type WaIdKind,
} from '../src/whatsapp/identity/wa-id.js';

// ─── JID Parsing ─────────────────────────────────────────────────────────

describe('wa-id — parseWaId', () => {
  it('parses individual JID (s.whatsapp.net)', () => {
    const p = parseWaId('15551234567@s.whatsapp.net');
    expect(p.kind).toBe('user');
    expect(p.id).toBe('15551234567');
    expect(p.domain).toBe('s.whatsapp.net');
  });

  it('parses individual JID (c.us)', () => {
    const p = parseWaId('15551234567@c.us');
    expect(p.kind).toBe('user');
    expect(p.id).toBe('15551234567');
    expect(p.domain).toBe('c.us');
  });

  it('parses group JID', () => {
    const p = parseWaId('120363012345678901@g.us');
    expect(p.kind).toBe('group');
    expect(p.id).toBe('120363012345678901');
    expect(p.domain).toBe('g.us');
  });

  it('parses LID JID', () => {
    const p = parseWaId('1234567890@lid');
    expect(p.kind).toBe('lid');
    expect(p.id).toBe('1234567890');
    expect(p.domain).toBe('lid');
  });

  it('parses status broadcast JID', () => {
    const p = parseWaId('status@broadcast');
    expect(p.kind).toBe('status');
    expect(p.id).toBe('status');
    expect(p.domain).toBe('broadcast');
  });

  it('parses newsletter/channel JID', () => {
    const p = parseWaId('1234567890@newsletter');
    expect(p.kind).toBe('newsletter');
    expect(p.id).toBe('1234567890');
    expect(p.domain).toBe('newsletter');
  });

  it('parses broadcast list JID', () => {
    const p = parseWaId('12345@broadcast');
    expect(p.kind).toBe('broadcast');
    expect(p.id).toBe('12345');
  });

  it('handles device suffix', () => {
    const p = parseWaId('15551234567:7@s.whatsapp.net');
    expect(p.kind).toBe('user');
    expect(p.id).toBe('15551234567');
    expect(p.device).toBe(7);
  });

  it('handles device suffix on group JID', () => {
    const p = parseWaId('120363012345678901:1@g.us');
    expect(p.kind).toBe('group');
    expect(p.id).toBe('120363012345678901');
    expect(p.device).toBeUndefined();
  });

  it('returns unknown for invalid JID', () => {
    const p = parseWaId('not-a-jid');
    expect(p.kind).toBe('unknown');
    expect(p.id).toBe('not-a-jid');
    expect(p.domain).toBe('');
  });

  it('returns unknown for unrecognized domain', () => {
    const p = parseWaId('12345@unknown.domain');
    expect(p.kind).toBe('unknown');
    expect(p.id).toBe('12345');
  });
});

// ─── Normalization ───────────────────────────────────────────────────────

describe('wa-id — toBaileysJid', () => {
  it('converts c.us to s.whatsapp.net so Baileys can deliver', () => {
    expect(toBaileysJid('15551234567@c.us')).toBe('15551234567@s.whatsapp.net');
  });

  it('keeps s.whatsapp.net', () => {
    expect(toBaileysJid('15551234567@s.whatsapp.net')).toBe('15551234567@s.whatsapp.net');
  });

  it('keeps lid, group, and status dialects', () => {
    expect(toBaileysJid('123456789012345@lid')).toBe('123456789012345@lid');
    expect(toBaileysJid('120363012345678901@g.us')).toBe('120363012345678901@g.us');
    expect(toBaileysJid('status@broadcast')).toBe('status@broadcast');
  });
});

describe('wa-id — toNeutralJid', () => {
  it('normalizes s.whatsapp.net to c.us', () => {
    expect(toNeutralJid('15551234567@s.whatsapp.net')).toBe('15551234567@c.us');
  });

  it('normalizes c.us (already neutral)', () => {
    expect(toNeutralJid('15551234567@c.us')).toBe('15551234567@c.us');
  });

  it('strips device suffix during normalization', () => {
    expect(toNeutralJid('15551234567:7@s.whatsapp.net')).toBe('15551234567@c.us');
  });

  it('normalizes group JID (strips device suffix)', () => {
    expect(toNeutralJid('120363012345678901@g.us')).toBe('120363012345678901@g.us');
  });

  it('preserves LID when no resolver provided', () => {
    expect(toNeutralJid('1234567890@lid')).toBe('1234567890@lid');
  });

  it('resolves LID to phone when resolver returns a value', () => {
    expect(toNeutralJid('1234567890@lid', () => '15551234567')).toBe('15551234567@c.us');
  });

  it('preserves LID when resolver returns null', () => {
    expect(toNeutralJid('1234567890@lid', () => null)).toBe('1234567890@lid');
  });

  it('normalizes status broadcast', () => {
    expect(toNeutralJid('status@broadcast')).toBe('status@broadcast');
  });

  it('normalizes newsletter', () => {
    expect(toNeutralJid('1234567890@newsletter')).toBe('1234567890@newsletter');
  });

  it('normalizes broadcast list', () => {
    expect(toNeutralJid('12345@broadcast')).toBe('12345@broadcast');
  });

  it('passes through unknown JID unchanged', () => {
    expect(toNeutralJid('foo@bar.com')).toBe('foo@bar.com');
  });
});

// ─── chatKind Classification ─────────────────────────────────────────────

describe('wa-id — chatKind', () => {
  it('classifies individual (s.whatsapp.net)', () => {
    expect(chatKind('15551234567@s.whatsapp.net')).toBe('individual');
  });

  it('classifies individual (c.us)', () => {
    expect(chatKind('15551234567@c.us')).toBe('individual');
  });

  it('classifies LID as individual', () => {
    expect(chatKind('1234567890@lid')).toBe('individual');
  });

  it('classifies group', () => {
    expect(chatKind('120363012345678901@g.us')).toBe('group');
  });

  it('classifies status', () => {
    expect(chatKind('status@broadcast')).toBe('status');
  });

  it('classifies channel (newsletter)', () => {
    expect(chatKind('1234567890@newsletter')).toBe('channel');
  });

  it('classifies broadcast list', () => {
    expect(chatKind('12345@broadcast')).toBe('broadcast');
  });

  it('classifies unknown', () => {
    expect(chatKind('foo@bar.com')).toBe('unknown');
  });

  it('classifies with device suffix', () => {
    expect(chatKind('15551234567:7@s.whatsapp.net')).toBe('individual');
  });
});

// ─── Helper Functions ────────────────────────────────────────────────────

describe('wa-id — isLidJid', () => {
  it('returns true for @lid JID', () => {
    expect(isLidJid('1234567890@lid')).toBe(true);
  });

  it('returns false for @s.whatsapp.net JID', () => {
    expect(isLidJid('15551234567@s.whatsapp.net')).toBe(false);
  });

  it('returns false for @c.us JID', () => {
    expect(isLidJid('15551234567@c.us')).toBe(false);
  });
});

describe('wa-id — phoneFromNeutralJid', () => {
  it('extracts phone from @c.us JID', () => {
    expect(phoneFromNeutralJid('15551234567@c.us')).toBe('15551234567');
  });

  it('returns undefined for @s.whatsapp.net JID', () => {
    expect(phoneFromNeutralJid('15551234567@s.whatsapp.net')).toBeUndefined();
  });

  it('returns undefined for @lid JID', () => {
    expect(phoneFromNeutralJid('1234567890@lid')).toBeUndefined();
  });

  it('returns undefined for group JID', () => {
    expect(phoneFromNeutralJid('120363012345678901@g.us')).toBeUndefined();
  });
});

// ─── Message Mapper Tests ────────────────────────────────────────────────

describe('Baileys message mapper', () => {
  it('maps a text message (conversation)', async () => {
    const { mapBaileysMessage } = await import('../src/whatsapp/engine/baileys-message-mapper.js');
    const msg = {
      key: {
        id: 'msg-1',
        remoteJid: '15551234567@s.whatsapp.net',
        fromMe: false,
        participant: undefined,
      },
      message: { conversation: 'Hello world' },
      pushName: 'John',
      messageTimestamp: 1700000000,
    };
    const result = mapBaileysMessage(msg, 'me@s.whatsapp.net');
    expect(result.id).toBe('msg-1');
    expect(result.chatId).toBe('15551234567@c.us');
    expect(result.fromMe).toBe(false);
    expect(result.body).toBe('Hello world');
    expect(result.pushName).toBe('John');
  });

  it('maps an extended text message with reply context', async () => {
    const { mapBaileysMessage } = await import('../src/whatsapp/engine/baileys-message-mapper.js');
    const msg = {
      key: {
        id: 'msg-2',
        remoteJid: '120363012345678901@g.us',
        fromMe: false,
        participant: '15551234567@s.whatsapp.net',
      },
      message: {
        extendedTextMessage: {
          text: 'Group reply',
          contextInfo: { stanzaId: 'msg-1', participant: '15557654321@s.whatsapp.net' },
        },
      },
      pushName: 'Jane',
      messageTimestamp: 1700000001,
    };
    const result = mapBaileysMessage(msg, 'me@s.whatsapp.net');
    expect(result.body).toBe('Group reply');
    expect(result.chatId).toBe('120363012345678901@g.us');
    expect(result.isGroup).toBe(true);
    expect(result.quotedMessageId).toBe('msg-1');
  });

  it('maps an image message with caption', async () => {
    const { mapBaileysMessage } = await import('../src/whatsapp/engine/baileys-message-mapper.js');
    const msg = {
      key: { id: 'msg-3', remoteJid: '15551234567@s.whatsapp.net', fromMe: true },
      message: {
        imageMessage: {
          caption: 'Check this out',
          mimetype: 'image/jpeg',
          fileLength: 1024n,
          url: 'https://example.com/img.jpg',
        },
      },
      messageTimestamp: 1700000002,
    };
    const result = mapBaileysMessage(msg, 'me@s.whatsapp.net');
    expect(result.fromMe).toBe(true);
    expect(result.body).toBe('Check this out');
  });

  it('maps a location message', async () => {
    const { mapBaileysMessage } = await import('../src/whatsapp/engine/baileys-message-mapper.js');
    const msg = {
      key: { id: 'msg-4', remoteJid: '15551234567@s.whatsapp.net', fromMe: false },
      message: {
        locationMessage: {
          degreesLatitude: 37.7749,
          degreesLongitude: -122.4194,
          name: 'San Francisco',
        },
      },
      messageTimestamp: 1700000003,
    };
    const result = mapBaileysMessage(msg, 'me@s.whatsapp.net');
    expect(result.location).toBeDefined();
    if (result.location) {
      expect(result.location.latitude).toBe(37.7749);
      expect(result.location.longitude).toBe(-122.4194);
      expect(result.location.name).toBe('San Francisco');
    }
  });

  it('unwraps view-once image envelopes so media is not dropped', async () => {
    const { mapBaileysMessage } = await import('../src/whatsapp/engine/baileys-message-mapper.js');
    const result = mapBaileysMessage({
      key: { id: 'vo-1', remoteJid: '15551234567@s.whatsapp.net', fromMe: false },
      message: {
        viewOnceMessage: {
          message: {
            imageMessage: { caption: 'secret pic', mimetype: 'image/jpeg' },
          },
        },
      },
      messageTimestamp: 1700000004,
    }, 'me@s.whatsapp.net');
    expect(result.type).toBe('image');
    expect(result.body).toBe('secret pic');
  });

  it('coerces Baileys Long timestamps instead of NaN', async () => {
    const { mapBaileysMessage } = await import('../src/whatsapp/engine/baileys-message-mapper.js');
    const result = mapBaileysMessage({
      key: { id: 'long-1', remoteJid: '15551234567@s.whatsapp.net', fromMe: false },
      message: { conversation: 'hi' },
      messageTimestamp: { toNumber: () => 1_700_000_123 },
    }, 'me@s.whatsapp.net');
    expect(result.timestamp).toBe(1_700_000_123);
    expect(Number.isFinite(result.timestamp)).toBe(true);
  });
});

describe('WWebJS message mapper', () => {
  it('maps a text message', async () => {
    const { mapWWebJsMessage } = await import('../src/whatsapp/engine/wwebjs-message-mapper.js');
    const msg = {
      id: { _serialized: 'msg-w1' },
      from: '15551234567@c.us',
      to: 'me@c.us',
      fromMe: false,
      body: 'Hello from wwebjs',
      hasMedia: false,
      type: 'chat',
      timestamp: 1700000000,
    };
    const result = mapWWebJsMessage(msg);
    expect(result.id).toBe('msg-w1');
    expect(result.chatId).toBe('15551234567@c.us');
    expect(result.fromMe).toBe(false);
    expect(result.body).toBe('Hello from wwebjs');
  });
});
