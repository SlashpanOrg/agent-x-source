import { afterEach, describe, expect, it } from 'vitest';
import type { Message } from '@agentx/shared';
import {
  applyRichResponsePolicy,
  disableRichResponseForSession,
  enableRichResponseForSession,
  getRichResponseMode,
} from '../src/agent/rich-response-policy.js';

const report = `# Architecture report

## Summary

The compatibility foundation should ship before proactive execution.

## Impact

| Module | Benefit | Risk |
| --- | --- | --- |
| Persistence | High | Low |
| Voice | Medium | Medium |`;

function message(parts?: Message['parts']): Message {
  return {
    id: 'assistant-1',
    sessionId: 'session-rich-test',
    role: 'assistant',
    content: report,
    toolCalls: null,
    createdAt: new Date(0).toISOString(),
    tokenCount: 100,
    ...(parts ? { parts } : {}),
  };
}

afterEach(() => {
  enableRichResponseForSession('session-rich-test');
});

describe('rich response policy', () => {
  it('is enabled in code by default', () => {
    expect(getRichResponseMode('session-rich-test')).toBe('on');
    const result = applyRichResponsePolicy('session-rich-test', message());
    expect(result.decision.attached).toBe(true);
  });

  it('attaches one validated snapshot when enabled', () => {
    const result = applyRichResponsePolicy('session-rich-test', message());
    expect(result.decision.attached).toBe(true);
    const rich = result.message.parts?.find((part) => part.type === 'response_document');
    expect(rich?.responseDocument?.revision).toBe(1);
    expect(rich?.fallbackMarkdown).toBe(report);
  });

  it('supports immediate per-session Markdown fallback', () => {
    disableRichResponseForSession('session-rich-test');
    expect(getRichResponseMode('session-rich-test')).toBe('off');
    expect(applyRichResponsePolicy('session-rich-test', message()).decision.attached).toBe(false);
  });

  it('never compiles a voice turn', () => {
    const result = applyRichResponsePolicy('session-rich-test', message(), {
      category: 'analysis',
      outputMode: 'detailed',
      voiceTurn: true,
    });
    expect(result.decision.reason).toBe('voice-turn');
    expect(result.decision.elapsedMs).toBe(0);
    expect(result.message.parts).toBeUndefined();
  });

  it('increments and replaces a prior snapshot instead of duplicating it', () => {
    const first = applyRichResponsePolicy('session-rich-test', message());
    const second = applyRichResponsePolicy('session-rich-test', message(first.message.parts));
    const rich = second.message.parts?.filter((part) => part.type === 'response_document') ?? [];
    expect(rich).toHaveLength(1);
    expect(rich[0]?.responseDocument?.revision).toBe(2);
  });
});
