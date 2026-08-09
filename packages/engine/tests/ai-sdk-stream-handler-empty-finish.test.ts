import { describe, it, expect, vi } from 'vitest';
import { createAiSdkStreamHandler } from '../src/agent/AiSdkStreamHandler.js';
import type { EngineEvent } from '@agentx/shared';

describe('AiSdkStreamHandler empty finish', () => {
  it('defers message_received when finish has reasoning but no text', () => {
    const events: EngineEvent[] = [];
    const handler = createAiSdkStreamHandler(
      (e) => { events.push(e); },
      'sess-1',
      () => {},
    );

    handler.handleEvent({ type: 'reasoning-delta', text: 'Detailed bid plan for the tender…' });
    handler.handleEvent({ type: 'finish', usage: { inputTokens: 10, outputTokens: 20 } });

    expect(handler.getState().deferredEmptyFinalize).toBe(true);
    expect(handler.getState().accumulatedReasoning).toContain('Detailed bid plan');
    expect(events.some((e) => e.type === 'message_received')).toBe(false);
    expect(events.some((e) => e.type === 'stream_chunk' && (e as { fullContent?: string }).fullContent?.includes('unable to generate'))).toBe(false);
    expect(events.some((e) => e.type === 'completion_finished')).toBe(true);
  });

  it('emits message_received normally when finish has text', () => {
    const events: EngineEvent[] = [];
    const handler = createAiSdkStreamHandler(
      (e) => { events.push(e); },
      'sess-1',
      () => {},
    );

    handler.handleEvent({ type: 'text-delta', text: 'Here is the playbook.' });
    handler.handleEvent({ type: 'finish', usage: { inputTokens: 5, outputTokens: 8 } });

    expect(handler.getState().deferredEmptyFinalize).toBe(false);
    const received = events.find((e) => e.type === 'message_received') as
      | { type: 'message_received'; message: { content: string } }
      | undefined;
    expect(received?.message.content).toBe('Here is the playbook.');
  });
});
