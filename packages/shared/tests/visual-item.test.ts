import { describe, expect, it } from 'vitest';
import type { MessagePart } from '../src/utils/message-parts.js';
import {
  attachVisualPartsFromTools,
  buildVisualItem,
  isHttpUrl,
  parseVisualItem,
  visualKindFromMime,
} from '../src/utils/index.js';

describe('visual item helpers', () => {
  it('builds and parses a storage-backed image', () => {
    const item = buildVisualItem({
      kind: 'image',
      title: 'Photo from Priya',
      storageId: 'att-1',
      caption: 'beach',
      mimeType: 'image/jpeg',
      attribution: 'WhatsApp · Priya',
    });
    expect(item).toMatchObject({
      kind: 'image',
      title: 'Photo from Priya',
      source: { storageId: 'att-1' },
      caption: 'beach',
      attribution: 'WhatsApp · Priya',
    });
    expect(parseVisualItem(item)).toEqual(item);
  });

  it('requires http(s) for url kind and rejects file sources', () => {
    expect(isHttpUrl('https://example.com/page')).toBe(true);
    expect(isHttpUrl('file:///tmp/x')).toBe(false);
    expect(buildVisualItem({ kind: 'url', title: 'Docs', url: 'javascript:alert(1)' })).toBeNull();
    expect(buildVisualItem({ kind: 'url', title: 'Docs', url: 'https://example.com' })?.source).toEqual({
      url: 'https://example.com',
    });
    expect(buildVisualItem({ kind: 'image', title: 'Nope', url: 'https://example.com' })).toBeNull();
  });

  it('maps mime types to visual kinds', () => {
    expect(visualKindFromMime('image/png')).toBe('image');
    expect(visualKindFromMime('video/mp4')).toBe('video');
    expect(visualKindFromMime('application/pdf')).toBe('document');
  });
});

describe('attachVisualPartsFromTools', () => {
  it('lifts present_visual metadata into visual parts', () => {
    const item = buildVisualItem({
      kind: 'document',
      title: 'Invoice',
      storageId: 'pdf-1',
      mimeType: 'application/pdf',
    });
    const parts: MessagePart[] = [{
      type: 'tool',
      id: 't1',
      tool: {
        id: 't1',
        name: 'present_visual',
        status: 'done',
        metadata: { visualItem: item },
      },
    }];
    const next = attachVisualPartsFromTools(parts);
    expect(next.some((p) => p.type === 'visual' && p.id === 't1' && p.visual?.title === 'Invoice')).toBe(true);
  });
});
