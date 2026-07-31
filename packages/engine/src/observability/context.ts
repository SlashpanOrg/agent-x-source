import { AsyncLocalStorage } from 'node:async_hooks';
import { context, trace } from '@opentelemetry/api';

export interface TurnContext {
  sessionId?: string;
  turnId?: string;
  traceId?: string;
}

const turnStorage = new AsyncLocalStorage<TurnContext>();

export function runWithTurnContext<T>(ctx: TurnContext, fn: () => T): T {
  return turnStorage.run(ctx, fn);
}

export function getTurnContext(): TurnContext | undefined {
  return turnStorage.getStore();
}

export function injectTraceparent(payload: Record<string, unknown>): void {
  const spanContext = trace.getSpanContext(context.active());
  if (!spanContext) return;
  const sampled = spanContext.traceFlags & 0x1 ? '01' : '00';
  payload.__traceparent = `00-${spanContext.traceId}-${spanContext.spanId}-${sampled}`;
}

export function extractTraceparent<T>(payload: Record<string, unknown>, fn: () => T): T {
  const traceparent = payload.__traceparent;
  if (typeof traceparent !== 'string' || traceparent.length < 55) {
    return fn();
  }
  const parts = traceparent.split('-');
  if (parts.length < 4 || parts[0] !== '00') {
    return fn();
  }
  const [, traceId, spanId, flags] = parts;
  const spanContext = {
    traceId: traceId!,
    spanId: spanId!,
    traceFlags: parseInt(flags!, 16) || 0,
    isRemote: true,
  };
  const extractedContext = trace.setSpanContext(context.active(), spanContext);
  return context.with(extractedContext, fn);
}
