import { describe, it, expect } from 'vitest';
import { CompactionManager } from '../src/communication/CompactionManager.js';
import type { Message } from '@agentx/shared';

describe('CompactionManager', () => {
  const manager = new CompactionManager({
    contextLimit: 10000,
    warnThreshold: 0.8,
    triggerThreshold: 0.85,
  });

  function makeMsg(content: string, role: Message['role'] = 'user'): Message {
    return {
      id: `msg-${Math.random().toString(36).slice(2)}`,
      sessionId: 'sess-1',
      role,
      content,
      toolCalls: null,
      tokenCount: Math.ceil(content.length / 4),
      createdAt: new Date().toISOString(),
    };
  }

  it('returns false when under threshold', () => {
    expect(manager.needsCompaction(5000)).toBe(false);
  });

  it('returns true when over threshold', () => {
    expect(manager.needsCompaction(9000)).toBe(true);
  });

  it('returns true for warning at 80%', () => {
    expect(manager.needsWarning(8000)).toBe(true);
    expect(manager.needsWarning(5000)).toBe(false);
  });

  it('compacts messages and returns a marker', async () => {
    const longContent = 'A'.repeat(5000);
    const messages = [
      makeMsg(longContent),
      makeMsg(longContent),
      makeMsg('recent message'),
    ];

    const result = await manager.compact(messages, 'sess-1');

    expect(result.ok).toBe(true);
    expect(result.marker.messageId).toBeTruthy();
    expect(result.tokensSaved).toBeGreaterThanOrEqual(0);
  });
});
