import { describe, it, expect } from 'vitest';
import { InputNormalizer } from '../src/communication/InputNormalizer.js';

describe('InputNormalizer', () => {
  const normalizer = new InputNormalizer();

  it('passes clean text through unchanged', async () => {
    const result = await normalizer.sanitize({
      turnId: 'turn-1',
      sessionId: 'sess-1',
      channel: 'api',
      userId: 'user-1',
      receivedAt: Date.now(),
      text: 'Hello, how are you?',
      attachments: [],
      metadata: {},
    });

    expect(result.cleanText).toBe('Hello, how are you?');
    expect(result.warnings).toHaveLength(0);
  });

  it('replaces invalid surrogate code points', async () => {
    const result = await normalizer.sanitize({
      turnId: 't1',
      sessionId: 's1',
      channel: 'api',
      userId: 'u1',
      receivedAt: 0,
      text: 'Hello \uD800world',
      attachments: [],
      metadata: {},
    });

    expect(result.cleanText).toContain('\uFFFD');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('strips disallowed control characters', async () => {
    const result = await normalizer.sanitize({
      turnId: 't1',
      sessionId: 's1',
      channel: 'api',
      userId: 'u1',
      receivedAt: 0,
      text: 'Click here\u0000for more\u0001 info',
      attachments: [],
      metadata: {},
    });

    expect(result.cleanText).not.toContain('\x00');
    expect(result.cleanText).not.toContain('\x01');
  });

  it('strips null bytes', async () => {
    const result = await normalizer.sanitize({
      turnId: 't1',
      sessionId: 's1',
      channel: 'api',
      userId: 'u1',
      receivedAt: 0,
      text: 'Hello\u0000World',
      attachments: [],
      metadata: {},
    });

    expect(result.cleanText).toBe('HelloWorld');
  });

  it('preserves legitimate newlines and tabs', async () => {
    const result = await normalizer.sanitize({
      turnId: 't1',
      sessionId: 's1',
      channel: 'api',
      userId: 'u1',
      receivedAt: 0,
      text: 'Line 1\nLine 2\tindented',
      attachments: [],
      metadata: {},
    });

    expect(result.cleanText).toContain('\n');
    expect(result.cleanText).toContain('\t');
  });

  it('resolves attachments', async () => {
    const result = await normalizer.sanitize({
      turnId: 't1',
      sessionId: 's1',
      channel: 'api',
      userId: 'u1',
      receivedAt: 0,
      text: 'Check this file',
      attachments: [
        {
          id: 'att-1',
          type: 'file',
          name: 'test.ts',
          data: 'console.log("hello")',
        },
      ],
      metadata: {},
    });

    expect(result.cleanAttachments).toHaveLength(1);
    expect(result.cleanAttachments[0]!.name).toBe('test.ts');
    expect(result.cleanAttachments[0]!.mimeType).toBe('text/typescript');
  });
});
