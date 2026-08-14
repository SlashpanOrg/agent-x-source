import type { VisualItem } from '@agentx/shared';
import { buildVisualItem } from '@agentx/shared';
import { peekWhatsAppVoiceBrief } from './whatsapp-voice-brief.js';
import { userWantsWhatsAppVisual } from './voice-speakable.js';

type PresentFn = (item: VisualItem) => void | Promise<void>;

let presentFn: PresentFn | null = null;

export function setVisualPresentEmitter(fn: PresentFn | null): void {
  presentFn = fn;
}

export function emitVisualPresent(item: VisualItem): void {
  try {
    void presentFn?.(item);
  } catch {
    /* best-effort */
  }
}

/** If the owner affirmed a pending WhatsApp media brief, open the visual stage. */
export function maybePresentWhatsAppVisual(text: string): boolean {
  if (!userWantsWhatsAppVisual(text)) return false;
  const brief = peekWhatsAppVoiceBrief();
  if (!brief?.mediaStorageId || !brief.mediaKind) return false;
  const item = buildVisualItem({
    kind: brief.mediaKind,
    title: brief.mediaTitle || `Message from ${brief.who}`,
    storageId: brief.mediaStorageId,
    caption: brief.mediaCaption || brief.text,
    mimeType: brief.mediaMime,
    attribution: `WhatsApp · ${brief.who}`,
  });
  if (!item) return false;
  emitVisualPresent(item);
  return true;
}
