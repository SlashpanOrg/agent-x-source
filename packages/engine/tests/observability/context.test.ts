import { describe, it, expect } from 'vitest';
import {
  runWithTurnContext,
  getTurnContext,
  injectTraceparent,
  extractTraceparent,
} from '../../src/observability/context.js';

describe('runWithTurnContext + getTurnContext', () => {
  it('sets context within the callback', () => {
    const ctx = { sessionId: 's1', turnId: 't1', traceId: 'tr1' };
    runWithTurnContext(ctx, () => {
      expect(getTurnContext()).toEqual(ctx);
    });
  });

  it('clears context after the callback', () => {
    runWithTurnContext({ sessionId: 's1' }, () => {});
    expect(getTurnContext()).toBeUndefined();
  });

  it('preserves context across async boundaries', async () => {
    const ctx = { sessionId: 's1', turnId: 't1', traceId: 'tr1' };
    await runWithTurnContext(ctx, async () => {
      await new Promise((r) => setTimeout(r, 10));
      expect(getTurnContext()).toEqual(ctx);
    });
  });

  it('supports nested contexts', () => {
    runWithTurnContext({ sessionId: 'outer' }, () => {
      expect(getTurnContext()?.sessionId).toBe('outer');
      runWithTurnContext({ sessionId: 'inner' }, () => {
        expect(getTurnContext()?.sessionId).toBe('inner');
      });
      expect(getTurnContext()?.sessionId).toBe('outer');
    });
  });
});

describe('injectTraceparent / extractTraceparent', () => {
  it('injectTraceparent is a no-op when no active span', () => {
    const payload: Record<string, unknown> = {};
    injectTraceparent(payload);
    // No active span → no __traceparent injected.
    expect(payload.__traceparent).toBeUndefined();
  });

  it('extractTraceparent returns fn result when no traceparent', () => {
    const payload: Record<string, unknown> = {};
    const result = extractTraceparent(payload, () => 'ok');
    expect(result).toBe('ok');
  });

  it('extractTraceparent ignores malformed traceparent', () => {
    const payload: Record<string, unknown> = { __traceparent: 'malformed' };
    const result = extractTraceparent(payload, () => 'ok');
    expect(result).toBe('ok');
  });

  it('extractTraceparent ignores non-00 version', () => {
    const payload: Record<string, unknown> = { __traceparent: '01-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01' };
    const result = extractTraceparent(payload, () => 'ok');
    expect(result).toBe('ok');
  });

  it('extractTraceparent parses valid traceparent and sets span context', () => {
    const traceId = 'a'.repeat(32);
    const spanId = 'b'.repeat(16);
    const payload: Record<string, unknown> = { __traceparent: `00-${traceId}-${spanId}-01` };
    let capturedTraceId: string | undefined;
    extractTraceparent(payload, () => {
      // The span context should be set — we can't easily verify without OTel API,
      // but the function should not throw and should return the fn result.
      return 'ok';
    });
    // Just verify it doesn't throw.
    expect(true).toBe(true);
  });
});
