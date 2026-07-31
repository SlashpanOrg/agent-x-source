/**
 * Helpers for app-domain (APP) instrumentation in the web-api package.
 *
 * The web-api package does not depend on `@opentelemetry/api` directly; these
 * helpers provide a minimal API for starting/ending APP-domain spans without
 * leaking OTel types across the package boundary.
 */
import { context, trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import { getTracer } from './tracer.js';

export interface AppSpan {
  /** Set a string/number/boolean attribute on the span. */
  setAttribute(key: string, value: string | number | boolean): void;
  /** Record an error event on the span. */
  recordError(message: string): void;
  /** Add a custom event. */
  addEvent(name: string, attrs?: Record<string, string | number | boolean>): void;
  /** End the span. */
  end(): void;
  /** The internal span — used by the wrapper to propagate context. */
  readonly _span: Span;
}

/**
 * Start an APP-domain span and make it the active context. Returns a handle
 * that the caller uses to set attributes and end the span. The returned
 * `next` function wraps a downstream call so it inherits the span's context.
 */
export function startAppSpan(
  name: string,
  kind: string,
  traceKind: string,
  attributes?: Record<string, string | number | boolean>,
): { span: AppSpan; withContext: <T>(fn: () => T) => T } {
  const span = getTracer().startSpan(name, {
    attributes: {
      'span.kind': kind,
      'trace.kind': traceKind,
      'trace.domain': 'APP',
      ...(attributes ?? {}),
    },
  });
  const appSpan: AppSpan = {
    setAttribute(key, value) { span.setAttribute(key, value); },
    recordError(message) {
      span.recordException(new Error(message));
      span.setStatus({ code: SpanStatusCode.ERROR, message });
    },
    addEvent(name, attrs) { span.addEvent(name, attrs); },
    end() { span.end(); },
    get _span() { return span; },
  };
  const activeCtx = trace.setSpan(context.active(), span);
  return {
    span: appSpan,
    withContext: <T>(fn: () => T): T => context.with(activeCtx, fn),
  };
}

/** End an app span with a status code (convenience for HTTP middleware). */
export function endAppSpan(span: AppSpan, attrs?: Record<string, string | number | boolean>): void {
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
  }
  span.end();
}
