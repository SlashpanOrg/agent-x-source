import type { VisualItem, VisualKind, VisualSource } from '../types/visual.js';
import { VISUAL_KINDS } from '../types/visual.js';

function newVisualId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `visual-${Date.now().toString(36)}`;
  }
}

export function isVisualKind(value: unknown): value is VisualKind {
  return typeof value === 'string' && (VISUAL_KINDS as readonly string[]).includes(value);
}

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function visualKindFromMime(mime: string | undefined, fallback: VisualKind = 'document'): VisualKind {
  const m = (mime ?? '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'document';
  return fallback;
}

export function parseVisualSource(raw: unknown): VisualSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const storageId = typeof rec.storageId === 'string' ? rec.storageId.trim() : '';
  const url = typeof rec.url === 'string' ? rec.url.trim() : '';
  if (storageId) return { storageId };
  if (url && isHttpUrl(url)) return { url };
  return null;
}

export function parseVisualItem(raw: unknown): VisualItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  if (!isVisualKind(rec.kind)) return null;
  const title = typeof rec.title === 'string' ? rec.title.trim() : '';
  if (!title) return null;
  const source = parseVisualSource(rec.source)
    ?? (typeof rec.storageId === 'string' && rec.storageId.trim()
      ? { storageId: rec.storageId.trim() }
      : typeof rec.url === 'string' && isHttpUrl(rec.url)
        ? { url: rec.url.trim() }
        : null);
  if (!source) return null;
  if (rec.kind === 'url' && !('url' in source)) return null;
  if (rec.kind !== 'url' && !('storageId' in source)) return null;
  const id = typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : newVisualId();
  return {
    id,
    kind: rec.kind,
    title,
    source,
    ...(typeof rec.caption === 'string' && rec.caption.trim() ? { caption: rec.caption.trim() } : {}),
    ...(typeof rec.mimeType === 'string' && rec.mimeType.trim() ? { mimeType: rec.mimeType.trim() } : {}),
    ...(typeof rec.attribution === 'string' && rec.attribution.trim() ? { attribution: rec.attribution.trim() } : {}),
  };
}

export function buildVisualItem(input: {
  kind: VisualKind;
  title: string;
  storageId?: string;
  url?: string;
  caption?: string;
  mimeType?: string;
  attribution?: string;
  id?: string;
}): VisualItem | null {
  return parseVisualItem({
    id: input.id,
    kind: input.kind,
    title: input.title,
    storageId: input.storageId,
    url: input.url,
    source: input.storageId
      ? { storageId: input.storageId }
      : input.url
        ? { url: input.url }
        : undefined,
    caption: input.caption,
    mimeType: input.mimeType,
    attribution: input.attribution,
  });
}
