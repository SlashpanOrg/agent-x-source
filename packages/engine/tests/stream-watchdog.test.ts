import { describe, it, expect } from 'vitest';
import { consumeStreamWithWatchdog } from '../src/agent/AiSdkStreamHandler.js';

/** Build an async iterable from a list of chunks with per-chunk delays (ms). */
function delayedStream<T>(items: Array<{ value: T; delayMs: number }>): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) {
        await new Promise((r) => setTimeout(r, item.delayMs));
        yield item.value;
      }
    },
  };
}

/** A stream that never yields another chunk after `initial` (simulates a dropped connection). */
function stalledStream<T>(initial: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const v of initial) yield v;
      // Hang forever — never resolves, never rejects.
      await new Promise(() => {});
    },
  };
}

describe('consumeStreamWithWatchdog', () => {
  it('consumes all chunks normally when the stream completes within the idle window', async () => {
    const stream = delayedStream([
      { value: 'a', delayMs: 5 },
      { value: 'b', delayMs: 5 },
      { value: 'c', delayMs: 5 },
    ]);
    const seen: string[] = [];
    const outcome = await consumeStreamWithWatchdog(stream, (chunk) => seen.push(chunk), 200);
    expect(outcome.stalled).toBe(false);
    expect(seen).toEqual(['a', 'b', 'c']);
  });

  it('reports stalled=true when the stream goes silent past the idle timeout', async () => {
    const stream = stalledStream(['first-chunk']);
    const seen: string[] = [];
    const outcome = await consumeStreamWithWatchdog(stream, (chunk) => seen.push(chunk), 50);
    expect(outcome.stalled).toBe(true);
    // Chunks received before the stall must still have been processed.
    expect(seen).toEqual(['first-chunk']);
  });

  it('does not report a stall for a slow-but-steady stream whose per-chunk gaps stay under the idle window', async () => {
    const stream = delayedStream([
      { value: 1, delayMs: 30 },
      { value: 2, delayMs: 30 },
      { value: 3, delayMs: 30 },
    ]);
    const seen: number[] = [];
    const outcome = await consumeStreamWithWatchdog(stream, (chunk) => seen.push(chunk), 100);
    expect(outcome.stalled).toBe(false);
    expect(seen).toEqual([1, 2, 3]);
  });
});
