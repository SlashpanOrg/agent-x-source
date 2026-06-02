import { describe, it, expect } from 'vitest';
import { StreamNormalizer } from '../src/communication/StreamNormalizer.js';
import type { AgentXStreamEvent } from '@agentx/shared';

describe('StreamNormalizer', () => {
  const normalizer = new StreamNormalizer();

  it('passes text delta events through', () => {
    const event: AgentXStreamEvent = {
      type: 'text.delta',
      messageId: 'msg-1',
      delta: 'Hello',
      ts: Date.now(),
    };

    const result = normalizer.normalize(event);
    expect(result).toEqual(event);
  });

  it('detects tool call patterns in text', () => {
    const event: AgentXStreamEvent = {
      type: 'text.delta',
      messageId: 'msg-1',
      delta: '[file_read] {"path": "test.ts"} [/file_read]',
      ts: Date.now(),
    };

    const result = normalizer.normalize(event);
    expect(Array.isArray(result)).toBe(true);
    const events = result as AgentXStreamEvent[];
    expect(events.some((e) => e.type === 'tool.input.start')).toBe(true);
    expect(events.some((e) => e.type === 'tool.input.delta')).toBe(true);
    expect(events.some((e) => e.type === 'tool.input.end')).toBe(true);
  });

  it('passes lifecycle events through and resets', () => {
    normalizer.normalize({
      type: 'turn.start',
      turnId: 't1',
      sessionId: 's1',
      ts: Date.now(),
    });

    const textEvent: AgentXStreamEvent = {
      type: 'text.delta',
      messageId: 'msg-1',
      delta: 'hello',
      ts: Date.now(),
    };

    // Turn end should reset
    normalizer.normalize({
      type: 'turn.end',
      turnId: 't1',
      stopReason: 'end_turn',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      ts: Date.now(),
    });

    const result = normalizer.normalize(textEvent);
    expect(result).toEqual(textEvent);
  });
});
