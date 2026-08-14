import { chatKind, toNeutralJid } from '../identity/wa-id.js';
import type { WhatsAppIncomingMessage } from '../engine/IWhatsAppEngine.js';
import { isAgentMarkedBody } from './constants.js';

export type InboundClass =
  | { kind: 'ignore'; reason: string }
  | { kind: 'owner_command'; text: string; chatId: string; messageId: string }
  | {
    kind: 'world';
    senderJid: string;
    chatId: string;
    text: string;
    isGroup: boolean;
    senderName?: string;
    messageId: string;
  };

export interface ClassifyContext {
  /** Neutral owner JIDs (`phone@c.us`, and any known owner LID). */
  ownerJids: readonly string[];
  recentOutboundIds?: Iterable<string>;
}

function normalizeOwnerSet(ownerJids: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const raw of ownerJids) {
    const n = toNeutralJid(raw);
    if (n) set.add(n);
  }
  return set;
}

export function isSelfChat(chatId: string, ownerJids: ReadonlySet<string>): boolean {
  const n = toNeutralJid(chatId);
  return ownerJids.has(n);
}

export function classifyWhatsAppInbound(
  msg: WhatsAppIncomingMessage,
  ctx: ClassifyContext,
): InboundClass {
  const chatId = toNeutralJid(msg.chatId || msg.from);
  const kind = chatKind(chatId);
  if (kind === 'status' || kind === 'channel' || kind === 'broadcast') {
    return { kind: 'ignore', reason: `non-conversation chat (${kind})` };
  }

  const ownerJids = normalizeOwnerSet(ctx.ownerJids);
  const outbound = new Set(ctx.recentOutboundIds ?? []);
  const text = (msg.body ?? '').trim();
  const self = isSelfChat(chatId, ownerJids);

  if (outbound.has(msg.id)) {
    return { kind: 'ignore', reason: 'echo of our outbound message' };
  }

  if (self) {
    if (isAgentMarkedBody(text)) {
      return { kind: 'ignore', reason: 'agent self-chat echo' };
    }
    if (!text) {
      return { kind: 'ignore', reason: 'empty self-chat message' };
    }
    return { kind: 'owner_command', text, chatId, messageId: msg.id };
  }

  if (msg.fromMe) {
    return { kind: 'ignore', reason: 'owner talking to the world' };
  }

  if (!text) {
    return { kind: 'ignore', reason: 'empty world message' };
  }

  const senderJid = toNeutralJid(msg.author ?? msg.from);
  return {
    kind: 'world',
    senderJid,
    chatId,
    text,
    isGroup: msg.isGroup || kind === 'group',
    senderName: msg.pushName,
    messageId: msg.id,
  };
}
