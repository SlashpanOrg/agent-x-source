import type { VisualKind } from '@agentx/shared';

/** Latest WhatsApp world brief for an active dashboard / super voice session. */
export interface WhatsAppVoiceBrief {
  who: string;
  text: string;
  senderJid: string;
  chatId: string;
  isGroup: boolean;
  mediaStorageId?: string;
  mediaKind?: VisualKind;
  mediaMime?: string;
  mediaCaption?: string;
  mediaTitle?: string;
}

let latest: WhatsAppVoiceBrief | null = null;

export function setWhatsAppVoiceBrief(brief: WhatsAppVoiceBrief): void {
  latest = brief;
}

export function peekWhatsAppVoiceBrief(): WhatsAppVoiceBrief | null {
  return latest;
}

export function clearWhatsAppVoiceBrief(): void {
  latest = null;
}

export function parseWhatsAppVoiceBriefFromContext(context: string): WhatsAppVoiceBrief | null {
  const sender = context.match(/^Sender:\s*(.+)$/m)?.[1]?.trim();
  const senderJid = context.match(/^JID:\s*(.+)$/m)?.[1]?.trim();
  const chatId = context.match(/^Chat:\s*(.+)$/m)?.[1]?.trim();
  const isGroup = /^Group:\s*yes$/im.test(context);
  const text = context.match(/^Text:\s*([\s\S]*?)\n(?:Media-Storage-Id:|The owner was just told)/m)?.[1]?.trim()
    ?? context.match(/^Text:\s*(.+)$/m)?.[1]?.trim();
  if (!sender || !text || !senderJid || !chatId) return null;
  const mediaStorageId = context.match(/^Media-Storage-Id:\s*(.+)$/m)?.[1]?.trim();
  const mediaKindRaw = context.match(/^Media-Kind:\s*(.+)$/m)?.[1]?.trim();
  const mediaKind = mediaKindRaw === 'image' || mediaKindRaw === 'video' || mediaKindRaw === 'document' || mediaKindRaw === 'url'
    ? mediaKindRaw
    : undefined;
  return {
    who: sender,
    text,
    senderJid,
    chatId,
    isGroup,
    ...(mediaStorageId ? {
      mediaStorageId,
      mediaKind,
      mediaMime: context.match(/^Media-Mime:\s*(.+)$/m)?.[1]?.trim(),
      mediaCaption: context.match(/^Media-Caption:\s*(.+)$/m)?.[1]?.trim(),
      mediaTitle: context.match(/^Media-Title:\s*(.+)$/m)?.[1]?.trim(),
    } : {}),
  };
}

export function formatWhatsAppVoiceBriefInstruction(brief: WhatsAppVoiceBrief): string {
  const mediaLine = brief.mediaStorageId
    ? `There is ${brief.mediaKind ?? 'media'} attached (storage ${brief.mediaStorageId}). It will be shown on the visual stage when they say yes / show me / read that — you still read the caption or text aloud.`
    : 'No visual media is attached.';
  return [
    '[WHATSAPP_PENDING_BRIEF]',
    `The owner was just told there is a WhatsApp message from ${brief.who}${brief.isGroup ? ' in a group' : ''}.`,
    `Full text: "${brief.text}"`,
    `Sender JID: ${brief.senderJid}`,
    `Chat: ${brief.chatId}`,
    mediaLine,
    'If they say yes / read it / what did they say — read the message aloud.',
    'If they ask to reply, send as them with whatsapp_send_text using their wording.',
    'If they ask for an emoji or reaction, use whatsapp_react or send the emoji as them.',
    'If they ask to ignore, archive, or set a standing order, do that.',
    '[/WHATSAPP_PENDING_BRIEF]',
  ].join('\n');
}
