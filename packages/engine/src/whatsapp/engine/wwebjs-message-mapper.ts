/**
 * Maps `whatsapp-web.js`'s native `Message` shape to Agent-X's canonical
 * `WhatsAppIncomingMessage` (IWhatsAppEngine.ts).
 *
 * `whatsapp-web.js` already normalizes JIDs to the `@c.us` / `@g.us` dialect
 * (its `_serialized` id format), so unlike the Baileys mapper we don't need
 * LID handling here — `whatsapp-web.js` resolves LIDs to phone JIDs internally
 * before surfacing messages.
 *
 * Written from scratch against the `whatsapp-web.js` `Message` interface
 * (see `index.d.ts`), not copied from any reference project. Message-type
 * mapping is an inherent property of the WhatsApp protocol vocabulary.
 */
import type { Message, MessageMedia, MessageAck } from 'whatsapp-web.js';
import * as WAWebModule from 'whatsapp-web.js';
import type { WhatsAppIncomingMessage, WhatsAppMessageType, WhatsAppMessageStatus } from './IWhatsAppEngine.js';

const WA = (WAWebModule as any).default ?? (WAWebModule as any);
const { MessageAck: MessageAckV } = WA;

/** `whatsapp-web.js` `MessageTypes` enum value → our neutral vocabulary. */
const TYPE_MAP: Partial<Record<string, WhatsAppMessageType>> = {
  chat: 'text',
  audio: 'audio',
  ptt: 'voice',
  image: 'image',
  video: 'video',
  document: 'document',
  sticker: 'sticker',
  location: 'location',
  vcard: 'contact',
  multi_vcard: 'contact',
  poll_creation: 'poll',
  revoked: 'revoked',
  call_log: 'call',
};

function mapType(type: string): WhatsAppMessageType {
  return TYPE_MAP[type] ?? 'unknown';
}

/** `whatsapp-web.js` `MessageAck` → our neutral ack status. */
export function ackStatusFromWWebJs(ack: MessageAck): WhatsAppMessageStatus {
  switch (ack) {
    case MessageAckV.ACK_ERROR:
      return 'failed';
    case MessageAckV.ACK_PENDING:
      return 'pending';
    case MessageAckV.ACK_SERVER:
      return 'sent';
    case MessageAckV.ACK_DEVICE:
      return 'delivered';
    case MessageAckV.ACK_READ:
    case MessageAckV.ACK_PLAYED:
      return 'read';
    default:
      return 'pending';
  }
}

/**
 * Map a `whatsapp-web.js` `Message` to our canonical shape. Media is NOT
 * downloaded here — `whatsapp-web.js` requires an async `msg.downloadMedia()`
 * call, so the caller handles that (same pattern as the Baileys mapper).
 */
export function mapWWebJsMessage(
  msg: Message,
  resolvedMedia?: { mimetype: string; data?: string; omitted?: boolean; sizeBytes?: number; fileName?: string; caption?: string },
): WhatsAppIncomingMessage {
  const from = msg.from ?? '';
  const to = msg.to ?? '';
  const isGroup = from.endsWith('@g.us') || to.endsWith('@g.us');
  const chatId = msg.fromMe ? to : from;
  const author = isGroup ? (msg.author ?? from) : undefined;

  const location: WhatsAppIncomingMessage['location'] = msg.location
    ? {
        latitude: Number(msg.location.latitude),
        longitude: Number(msg.location.longitude),
        name: msg.location.name ?? undefined,
        address: msg.location.address ?? undefined,
      }
    : undefined;

  return {
    id: msg.id._serialized,
    chatId,
    from: msg.fromMe ? to : from,
    to: msg.fromMe ? from : to,
    author,
    fromMe: msg.fromMe,
    isGroup,
    type: mapType(msg.type),
    body: msg.body ?? '',
    timestamp: msg.timestamp ?? 0,
    quotedMessageId: msg.hasQuotedMsg ? undefined : undefined, // wwebjs needs async getQuotedMessage(); caller fills this
    mentions: msg.mentionedIds && msg.mentionedIds.length > 0 ? msg.mentionedIds : undefined,
    isLidSender: false, // wwebjs resolves LIDs to phone JIDs internally
    senderPhone: undefined,
    pushName: undefined, // wwebjs doesn't expose pushName on Message; caller can get it via msg.getContact()
    ephemeralDuration: msg.isEphemeral ? undefined : undefined, // wwebjs doesn't expose the duration directly
    media: resolvedMedia,
    location,
    raw: msg,
  };
}

/** Convert a `whatsapp-web.js` `MessageMedia` to our media descriptor. */
export function mediaFromWWebJs(media: MessageMedia, sizeCapBytes?: number): { mimetype: string; data?: string; omitted?: boolean; sizeBytes?: number; fileName?: string } {
  const size = media.filesize ?? undefined;
  if (size && sizeCapBytes && size > sizeCapBytes) {
    return { mimetype: media.mimetype, omitted: true, sizeBytes: size, fileName: media.filename ?? undefined };
  }
  return {
    mimetype: media.mimetype,
    data: media.data,
    sizeBytes: size ?? undefined,
    fileName: media.filename ?? undefined,
  };
}
