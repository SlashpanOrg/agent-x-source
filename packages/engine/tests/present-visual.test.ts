import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolExecutionContext } from '@agentx/shared';

const getAttachment = vi.fn();

vi.mock('../src/attachments/index.js', () => ({
  getAttachmentService: () => ({
    getAttachment: (...args: unknown[]) => getAttachment(...args),
  }),
}));

import { presentVisual } from '../src/tools/builtin/present-visual.js';
import { setVisualPresentHook } from '../src/visual/present-hook.js';

function ctx(sessionId: string): ToolExecutionContext {
  return { sessionId, scopePath: '/tmp', timeout: 5_000 };
}

describe('present_visual', () => {
  const presented: unknown[] = [];

  beforeEach(() => {
    presented.length = 0;
    getAttachment.mockReset();
    getAttachment.mockReturnValue({ id: 'att-1' });
    setVisualPresentHook((item) => { presented.push(item); });
  });

  afterEach(() => {
    setVisualPresentHook(null);
  });

  it('rejects an invalid kind', async () => {
    const result = await presentVisual({ kind: 'gif', title: 'Nope' }, ctx('chat-1'));
    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_KIND');
    expect(presented).toHaveLength(0);
  });

  it('requires storageId or url for image/video/document', async () => {
    const result = await presentVisual({ kind: 'image', title: 'Photo' }, ctx('chat-1'));
    expect(result.success).toBe(false);
    expect(result.error).toBe('MISSING_INPUT');
  });

  it('shows a web image URL on the voice stage without storageId', async () => {
    const result = await presentVisual(
      { kind: 'image', title: 'BMW M3', url: 'images.pexels.com/photos/123.jpeg' },
      ctx('__channel__:voice'),
    );
    expect(result.success).toBe(true);
    expect(result.metadata?.visualItem).toMatchObject({
      kind: 'image',
      title: 'BMW M3',
      source: { url: 'https://images.pexels.com/photos/123.jpeg' },
    });
    expect(presented).toHaveLength(1);
  });

  it('opens the voice stage on a voiceTurn even when sessionId is not the voice channel', async () => {
    const result = await presentVisual(
      { kind: 'url', title: 'Docs', url: 'https://example.com' },
      { ...ctx('some-ws-id'), voiceTurn: true },
    );
    expect(result.success).toBe(true);
    expect(presented).toHaveLength(1);
  });

  it('accepts href / image_url aliases for a web photo', async () => {
    const result = await presentVisual(
      { kind: 'image', title: 'M3', image_url: 'https://images.pexels.com/photos/1.jpeg' },
      ctx('__channel__:voice'),
    );
    expect(result.success).toBe(true);
    expect(result.metadata?.visualItem).toMatchObject({
      kind: 'image',
      source: { url: 'https://images.pexels.com/photos/1.jpeg' },
    });
    expect(presented).toHaveLength(1);
  });

  it('returns visual metadata in chat without opening the voice stage', async () => {
    const result = await presentVisual(
      { kind: 'image', title: 'Photo', storageId: 'att-1' },
      ctx('chat-session'),
    );
    expect(result.success).toBe(true);
    expect(result.metadata?.visualItem).toMatchObject({
      kind: 'image',
      title: 'Photo',
      source: { storageId: 'att-1' },
    });
    expect(presented).toHaveLength(0);
  });

  it('notifies the voice hook for dashboard and crew voice sessions', async () => {
    const voice = await presentVisual(
      { kind: 'url', title: 'Docs', url: 'https://example.com' },
      ctx('__channel__:voice'),
    );
    expect(voice.success).toBe(true);
    expect(presented).toHaveLength(1);

    const crew = await presentVisual(
      { kind: 'video', title: 'Clip', storageId: 'att-1' },
      ctx('voice:crew-private-1'),
    );
    expect(crew.success).toBe(true);
    expect(presented).toHaveLength(2);
  });

  it('fails when the attachment is missing', async () => {
    getAttachment.mockReturnValue(undefined);
    const result = await presentVisual(
      { kind: 'document', title: 'PDF', storageId: 'missing' },
      ctx('__channel__:voice'),
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('NOT_FOUND');
    expect(presented).toHaveLength(0);
  });
});
