import { describe, it, expect } from 'vitest';
import { ResponseAssembler } from '../src/communication/ResponseAssembler.js';
import type { AgentXStreamEvent } from '@agentx/shared';

describe('ResponseAssembler', () => {
  it('accumulates text deltas into final message', () => {
    const assembler = new ResponseAssembler();
    assembler.feed({ type: 'text.start', messageId: 'm1', ts: 0 });
    assembler.feed({ type: 'text.delta', messageId: 'm1', delta: 'Hello ', ts: 1 });
    assembler.feed({ type: 'text.delta', messageId: 'm1', delta: 'World', ts: 2 });
    assembler.feed({ type: 'text.end', messageId: 'm1', ts: 3 });
    assembler.feed({ type: 'turn.end', turnId: 't1', stopReason: 'end_turn', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, ts: 4 });

    const msg = assembler.assemble();
    expect(msg.text).toBe('Hello World');
    expect(msg.usage.totalTokens).toBe(15);
    expect(msg.stopReason).toBe('end_turn');
  });

  it('accumulates reasoning separately', () => {
    const assembler = new ResponseAssembler();
    assembler.feed({ type: 'reasoning.start', reasoningId: 'r1', ts: 0 });
    assembler.feed({ type: 'reasoning.delta', reasoningId: 'r1', delta: 'Let me think...', ts: 1 });
    assembler.feed({ type: 'reasoning.end', reasoningId: 'r1', ts: 2 });

    const msg = assembler.assemble();
    expect(msg.reasoning).toContain('Let me think...');
    expect(msg.text).toBe('');
  });

  it('tracks tool calls with status updates', () => {
    const assembler = new ResponseAssembler();
    assembler.feed({ type: 'tool.input.start', toolCallId: 'tc1', toolName: 'file_read', ts: 0 });
    assembler.feed({ type: 'tool.input.delta', toolCallId: 'tc1', delta: '{"path":"test.ts"}', ts: 1 });
    assembler.feed({ type: 'tool.input.end', toolCallId: 'tc1', ts: 2 });
    assembler.feed({ type: 'tool.execute.end', toolCallId: 'tc1', ok: true, durationMs: 42, ts: 3 });

    const msg = assembler.assemble();
    expect(msg.toolCalls).toHaveLength(1);
    expect(msg.toolCalls[0]!.name).toBe('file_read');
    expect(msg.toolCalls[0]!.status).toBe('completed');
    expect(msg.toolCalls[0]!.durationMs).toBe(42);
  });

  it('resets correctly', () => {
    const assembler = new ResponseAssembler();
    assembler.feed({ type: 'text.delta', messageId: 'm1', delta: 'old', ts: 0 });
    assembler.reset();
    assembler.feed({ type: 'text.delta', messageId: 'm2', delta: 'new', ts: 1 });

    const msg = assembler.assemble();
    expect(msg.text).toBe('new');
  });
});
