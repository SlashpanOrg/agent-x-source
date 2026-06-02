import { describe, it, expect } from 'vitest';
import { StaleWatchdog } from '../src/communication/StaleWatchdog.js';
import { IdleTimeoutBreaker } from '../src/communication/IdleTimeoutBreaker.js';
import { RetryStatusBuffer } from '../src/communication/RetryStatusBuffer.js';
import { ToolResultReinjector } from '../src/communication/ToolResultReinjector.js';
import { createChannelAdapter } from '../src/communication/visuals/ChannelAdapter.js';

describe('StaleWatchdog', () => {
  it('creates with default timeouts', () => {
    const wd = new StaleWatchdog();
    expect(wd.signal).toBeDefined();
    expect(wd.signal.aborted).toBe(false);
    wd.clear();
  });

  it('can be poked and cleared', () => {
    const wd = new StaleWatchdog(5000, 5000);
    wd.poke();
    wd.markFirstByte();
    wd.clear();
    // After clear(), the signal should be accessible
    expect(wd.signal).toBeDefined();
  });
});

describe('IdleTimeoutBreaker', () => {
  it('counts consecutive timeouts', () => {
    const breaker = new IdleTimeoutBreaker(3);
    expect(breaker.shouldBreak()).toBe(false);
    breaker.step();
    breaker.step();
    expect(breaker.getCount()).toBe(2);
    expect(breaker.shouldBreak()).toBe(false);
    breaker.step();
    expect(breaker.shouldBreak()).toBe(true);
  });

  it('resets count', () => {
    const breaker = new IdleTimeoutBreaker();
    breaker.step();
    breaker.step();
    breaker.reset();
    expect(breaker.getCount()).toBe(0);
  });
});

describe('RetryStatusBuffer', () => {
  it('buffers status messages per turn', () => {
    const buf = new RetryStatusBuffer();
    buf.add('t1', 'Attempt 1: timeout');
    buf.add('t1', 'Attempt 2: rate limit');
    expect(buf.hasEntries('t1')).toBe(true);
  });

  it('flushes and clears', () => {
    const buf = new RetryStatusBuffer();
    buf.add('t2', 'Error');
    const flushed = buf.flush('t2');
    expect(flushed).toContain('Error');
    expect(buf.hasEntries('t2')).toBe(false);
  });
});

describe('ToolResultReinjector', () => {
  it('builds tool result message', () => {
    const msg = ToolResultReinjector.buildToolResultMessage({
      id: 'tc1', name: 'file_read', arguments: {}, status: 'completed', result: 'content',
    });
    expect(msg.role).toBe('tool');
    expect(msg.toolCallId).toBe('tc1');
  });

  it('truncates large outputs', () => {
    const msg = ToolResultReinjector.buildTruncatedToolResult({
      id: 'tc1', name: 'shell_exec', arguments: {}, status: 'completed', result: 'x'.repeat(15000),
    }, 100);
    const content = typeof msg.content === 'string' ? msg.content : '';
    expect(content.length).toBeLessThan(200);
    expect(content).toContain('truncated');
  });

  it('reinjects multiple results', () => {
    const msgs = ToolResultReinjector.reinject([
      { id: 'tc1', name: 'read', arguments: {}, status: 'completed', result: 'ok' },
      { id: 'tc2', name: 'write', arguments: {}, status: 'error', result: 'fail', error: 'err' },
    ]);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe('tool');
    expect(msgs[1]!.content?.[0]?.is_error).toBe(true);
  });
});

describe('ChannelAdapter', () => {
  it('creates web adapter', () => {
    const adapter = createChannelAdapter('web');
    const ctx = adapter.getContext();
    expect(ctx.supportsMarkdown).toBe(true);
  });

  it('formats text for discord (truncates long text)', () => {
    const adapter = createChannelAdapter('discord');
    const long = 'x'.repeat(2500);
    const formatted = adapter.formatText(long);
    expect(formatted.length).toBeLessThan(2500);
  });

  it('formats tool cards', () => {
    const adapter = createChannelAdapter('web');
    const text = adapter.formatToolCard({
      id: 'tc1', name: 'file_read', icon: '📖', label: 'Read', status: 'completed', isExpanded: false,
    });
    expect(text).toContain('📖');
    expect(text).toContain('Read');
  });

  it('renders visual updates for text channels', () => {
    const adapter = createChannelAdapter('discord');
    const result = adapter.renderUpdate({
      type: 'compaction_toast', action: 'start',
    });
    expect(result).toContain('Compacting');
  });
});
