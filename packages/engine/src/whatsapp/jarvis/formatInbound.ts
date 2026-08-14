import type { WhatsAppIncomingMessage } from '../engine/IWhatsAppEngine.js';

/** Text the owner agent / brief sees for an inbound WhatsApp message. */
export function formatInboundText(msg: WhatsAppIncomingMessage): string {
  switch (msg.type) {
    case 'text':
      return msg.body ?? '';
    case 'image':
    case 'video':
    case 'audio':
    case 'voice':
    case 'document':
    case 'sticker': {
      const caption = msg.media?.caption ?? msg.body ?? '';
      const mediaNote = `[${msg.type}${msg.media?.omitted ? ' (media omitted — too large)' : ''}]`;
      return caption ? `${mediaNote} ${caption}` : mediaNote;
    }
    case 'location': {
      if (msg.location) {
        const name = msg.location.name ? ` (${msg.location.name})` : '';
        return `[location] ${msg.location.latitude},${msg.location.longitude}${name}`;
      }
      return '[location]';
    }
    case 'contact':
      return msg.body || '[contact card]';
    case 'poll':
      return msg.body || '[poll]';
    case 'call':
      return msg.body || '[call notification]';
    case 'revoked':
      return '[message revoked]';
    case 'unknown':
    default:
      return msg.body || `[unknown message type: ${msg.type}]`;
  }
}
