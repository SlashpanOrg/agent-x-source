import { describe, it, expect } from 'vitest';
import { VisualEventBridge } from '../src/communication/visuals/VisualEventBridge.js';
import type { AgentXStreamEvent } from '@agentx/shared';

describe('VisualEventBridge', () => {
  it('returns text_update for text delta events', () => {
    const bridge = new VisualEventBridge(0);
    const event: AgentXStreamEvent = {
      type: 'text.delta',
      messageId: 'msg-1',
      delta: 'Hello world',
      ts: Date.now(),
    };

    const update = bridge.handleEvent(event);
    expect(update).not.toBeNull();
    expect(update!.type).toBe('text_update');
  });

  it('returns tool_card for tool input start', () => {
    const bridge = new VisualEventBridge(0);
    const event: AgentXStreamEvent = {
      type: 'tool.input.start',
      toolCallId: 'tc-1',
      toolName: 'file_read',
      ts: Date.now(),
    };

    const update = bridge.handleEvent(event);
    expect(update!.type).toBe('tool_card');
    const card = (update as { type: 'tool_card'; card: unknown }).card;
    expect((card as { name: string }).name).toBe('file_read');
    expect((card as { status: string }).status).toBe('pending');
  });

  it('returns thinking_update for reasoning events', () => {
    const bridge = new VisualEventBridge(0);
    bridge.handleEvent({ type: 'reasoning.start', reasoningId: 'r-1', ts: 0 });
    const update = bridge.handleEvent({
      type: 'reasoning.delta',
      reasoningId: 'r-1',
      delta: 'Let me think...',
      ts: 0,
    });

    expect(update!.type).toBe('thinking_update');
    const state = (update as { type: 'thinking_update'; state: { content: string } }).state;
    expect(state.content).toContain('Let me think...');
  });

  it('returns compaction_toast for compaction events', () => {
    const bridge = new VisualEventBridge(0);
    const startUpdate = bridge.handleEvent({
      type: 'compaction.start',
      sessionId: 's1',
      currentTokens: 10000,
      threshold: 8000,
      ts: 0,
    });

    expect(startUpdate!.type).toBe('compaction_toast');
    expect((startUpdate as { action: string }).action).toBe('start');

    const endUpdate = bridge.handleEvent({
      type: 'compaction.end',
      sessionId: 's1',
      ok: true,
      tokensSaved: 2000,
      ts: 0,
    });

    expect(endUpdate!.type).toBe('compaction_toast');
  });

  it('updates tool card status on tool execute end', () => {
    const bridge = new VisualEventBridge(0);
    bridge.handleEvent({
      type: 'tool.input.start',
      toolCallId: 'tc-1',
      toolName: 'shell_exec',
      ts: 0,
    });

    const update = bridge.handleEvent({
      type: 'tool.execute.end',
      toolCallId: 'tc-1',
      ok: true,
      durationMs: 42,
      ts: 0,
    });

    expect(update!.type).toBe('tool_card_update');
    const card = (update as { type: 'tool_card_update'; card: { status: string } }).card;
    expect(card.status).toBe('completed');
  });

  it('resets on turn.end', () => {
    const bridge = new VisualEventBridge(0);
    bridge.handleEvent({
      type: 'text.delta',
      messageId: 'm1',
      delta: 'hello',
      ts: 0,
    });
    bridge.handleEvent({
      type: 'turn.end',
      turnId: 't1',
      stopReason: 'end_turn',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      ts: 0,
    });

    const update = bridge.handleEvent({
      type: 'text.delta',
      messageId: 'm2',
      delta: 'new turn',
      ts: 0,
    });

    expect(update!.type).toBe('text_update');
  });
});
