import type { Request, Response, NextFunction } from 'express';
import { metricsRegistry } from '../metrics/MetricsRegistry.js';
import { startAppSpan } from '@agentx/engine';

/**
 * Request observability middleware — wraps every HTTP request in an OTel span
 * (domain='APP') and records metrics. Replaces/augments the legacy `requestMetrics`
 * middleware: the metrics counters are still incremented, and now a span is created
 * for each request so the waterfall shows HTTP latency.
 *
 * For /api/chat and turn-initiating endpoints, the HTTP span is the parent of the
 * turn span (so the waterfall shows request → turn). For all other endpoints, the
 * HTTP span is the root of its own trace.
 */
export function requestObservabilityMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  const method = req.method;
  const path = req.path;
  const route = (req.route?.path as string | undefined) ?? path;
  const requestId = (req as { id?: string }).id;
  const userAgent = req.get('user-agent');

  const { span, withContext } = startAppSpan(`http ${method} ${route}`, 'http', 'http_request', {
    'http.method': method,
    'http.route': route,
    'http.url': path,
    ...(requestId ? { 'http.request_id': requestId } : {}),
    ...(userAgent ? { 'http.user_agent': userAgent } : {}),
  });

  if (req.agentxSession?.token) {
    span.setAttribute('session.id', req.agentxSession.token);
  }

  // Make the span active so downstream handlers (e.g. the turn span) inherit it.
  withContext(() => next());

  let spanEnded = false;
  const endHttpSpan = () => {
    if (spanEnded) return;
    spanEnded = true;
    const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
    const durationMs = Math.round(durationSec * 1000);
    const status = res.statusCode;
    span.setAttribute('http.status_code', status);
    span.setAttribute('http.duration_ms', durationMs);
    if (status >= 500) {
      span.recordError(`HTTP ${status}`);
    } else if (status >= 400) {
      span.addEvent('client_error', { 'http.status_code': status });
    }
    span.end();

    // Metrics (same as the legacy requestMetrics middleware)
    metricsRegistry.incrementCounter('http_requests_total', { method, status }, 1);
    metricsRegistry.recordHistogram('http_request_duration_seconds', { method, status }, durationSec);
  };

  res.locals.httpSpan = span;
  res.locals.endHttpSpan = endHttpSpan;

  res.on('finish', () => {
    if (res.locals.httpSpanAutoEnd !== false) endHttpSpan();
  });
  res.on('error', endHttpSpan);
}
