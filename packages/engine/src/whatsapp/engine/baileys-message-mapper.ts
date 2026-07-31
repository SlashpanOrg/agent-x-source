/**
 * Maps Baileys' native `WAMessage` shape to Agent-X's canonical
 * `WhatsAppIncomingMessage` (IWhatsAppEngine.ts). Written from scratch against
 * the actual `@whiskeysockets/baileys` message envelope — see
 * `WAProto.IWebMessageInfo` / `WAMessageKey` / `proto.IMessage` — not copied
 * from any reference project (message-type mapping tables are an inherent
 * property of the WhatsApp protocol, not anyone's IP).
 */
import type { WAMessage, proto } from '@whiskeysockets/baileys';
import { getContentType } from '@whiskeysockets/baileys';
import type { WhatsAppIncomingMessage, WhatsAppMessageType } from './IWhatsAppEngine.js';
import { toNeutralJid, isLidJid } from '../identity/wa-id.js';

/** Baileys' `getContentType()` key -> our neutral vocabulary. */
const TYPE_MAP: Partial<Record<string, WhatsAppMessageType>> = {
  conversation: 'text',
  extendedTextMessage: 'text',
  imageMessage: 'image',
  videoMessage: 'video',
  documentMessage: 'document',
  documentWithCaptionMessage: 'document',
  stickerMessage: 'sticker',
  locationMessage: 'location',
  liveLocationMessage: 'location',
  contactMessage: 'contact',
  contactsArrayMessage: 'contact',
  pollCreationMessage: 'poll',
  pollCreationMessageV2: 'poll',
  pollCreationMessageV3: 'poll',
  reactionMessage: 'unknown', // reactions are surfaced via a dedicated callback, not as a message
  protocolMessage: 'revoked',
  buttonsMessage: 'text',
  templateMessage: 'text',
  interactiveMessage: 'text',
  listMessage: 'text',
};

function resolveAudioType(msg: proto.IMessage): WhatsAppMessageType {
  return msg.audioMessage?.ptt ? 'voice' : 'audio';
}

/** Best-effort display text extraction across the many WhatsApp Business "interactive" shapes. */
function extractBody(msg: proto.IMessage, contentType: string | undefined): string {
  if (msg.conversation) return msg.conversation;
  if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text;
  if (msg.imageMessage?.caption) return msg.imageMessage.caption;
  if (msg.videoMessage?.caption) return msg.videoMessage.caption;
  if (msg.documentMessage?.caption) return msg.documentMessage.caption;
  if (msg.buttonsMessage?.contentText) return msg.buttonsMessage.contentText;
  if (msg.templateMessage?.hydratedTemplate?.hydratedContentText) {
    return msg.templateMessage.hydratedTemplate.hydratedContentText;
  }
  if (msg.interactiveMessage?.body?.text) return msg.interactiveMessage.body.text;
  if (msg.listMessage?.description) return msg.listMessage.description;
  if (contentType === 'protocolMessage') return '';
  return '';
}

function extractEphemeralDuration(info: WAMessage): number | undefined {
  return info.ephemeralDuration ?? info.message?.extendedTextMessage?.contextInfo?.expiration ?? undefined;
}

function extractMentions(msg: proto.IMessage): string[] | undefined {
  const contextInfo =
    msg.extendedTextMessage?.contextInfo
    ?? msg.imageMessage?.contextInfo
    ?? msg.videoMessage?.contextInfo
    ?? msg.documentMessage?.contextInfo;
  const mentioned = contextInfo?.mentionedJid;
  if (!mentioned || mentioned.length === 0) return undefined;
  return mentioned.map((jid) => toNeutralJid(jid));
}

export interface BaileysMediaResolution {
  mimetype: string;
  data?: string;
  omitted?: boolean;
  sizeBytes?: number;
  fileName?: string;
  caption?: string;
}

/**
 * Map a Baileys `WAMessage` to our canonical shape. Media is NOT downloaded
 * here (that's an async, size-capped, concurrency-limited operation handled
 * by the caller — Phase 4.5) — `resolvedMedia` lets the caller inject the
 * already-downloaded (or intentionally-omitted) media payload.
 */
export function mapBaileysMessage(
  info: WAMessage,
  meJid: string,
  resolvedMedia?: BaileysMediaResolution,
): WhatsAppIncomingMessage {
  const msg = info.message ?? {};
  const contentType = getContentType(msg);
  const rawFrom = info.key.remoteJid ?? '';
  const rawAuthor = info.key.participant ?? info.participant ?? undefined;

  const isGroup = rawFrom.endsWith('@g.us');
  const chatId = toNeutralJid(rawFrom);
  const from = isGroup && rawAuthor ? toNeutralJid(rawAuthor) : chatId;
  const fromMe = info.key.fromMe === true;

  let type: WhatsAppMessageType = (contentType && TYPE_MAP[contentType]) || 'unknown';
  if (contentType === 'audioMessage') type = resolveAudioType(msg);

  const location = msg.locationMessage
    ? {
      latitude: msg.locationMessage.degreesLatitude ?? 0,
      longitude: msg.locationMessage.degreesLongitude ?? 0,
      name: msg.locationMessage.name ?? undefined,
      address: msg.locationMessage.address ?? undefined,
    }
    : undefined;

  const timestampRaw = info.messageTimestamp;
  const timestamp = typeof timestampRaw === 'number' ? timestampRaw : Number(timestampRaw ?? 0);

  return {
    id: info.key.id ?? '',
    chatId,
    from,
    to: fromMe ? chatId : toNeutralJid(meJid),
    author: isGroup ? from : undefined,
    fromMe,
    isGroup,
    type,
    body: extractBody(msg, contentType),
    timestamp,
    quotedMessageId: msg.extendedTextMessage?.contextInfo?.stanzaId ?? undefined,
    mentions: extractMentions(msg),
    isLidSender: isLidJid(info.key.remoteJidAlt ?? rawAuthor ?? rawFrom),
    senderPhone: undefined, // resolved by caller via LidMappingStore when isLidSender is true
    pushName: info.pushName ?? undefined,
    ephemeralDuration: extractEphemeralDuration(info),
    media: resolvedMedia,
    location,
    raw: info,
  };
}

/**
 * Extract a lid<->phone pair from a message key's `remoteJidAlt`/`participantAlt`
 * fields, if present. Baileys v7 surfaces one side as `@lid` and the other as
 * a phone JID on the same key when both are known — this is how the engine
 * learns mappings passively from ordinary message traffic (in addition to
 * the explicit `lid-mapping.update` event).
 */
export function extractLidPairFromKey(key: WAMessage['key']): { lid: string; phone: string } | undefined {
  const candidates = [
    { a: key.remoteJid, b: key.remoteJidAlt },
    { a: key.participant, b: key.participantAlt },
  ];
  for (const { a, b } of candidates) {
    if (!a || !b) continue;
    const aIsLid = a.endsWith('@lid');
    const bIsLid = b.endsWith('@lid');
    if (aIsLid && !bIsLid) return { lid: a.split('@')[0]!, phone: b.split('@')[0]!.split(':')[0]! };
    if (bIsLid && !aIsLid) return { lid: b.split('@')[0]!, phone: a.split('@')[0]!.split(':')[0]! };
  }
  return undefined;
}
