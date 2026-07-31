/**
 * SSE live tail endpoint (§9.5).
 *
 *   GET /api/observability/stream?sessionId=&traceId=
 *
 * Server-Sent Events stream that:
 *   1. Subscribes to the engine TelemetryBus and emits each event as an SSE
 *      `data:` line (filtered by sessionId / traceId if provided).
 *   2. Polls the ObservabilityStore for new span/log rows every 2s (so the
 *      observability window updates live while a turn runs, even for events
 *      that don't go through the telemetry bus).
 *   3. Sends a heartbeat comment every 15s to keep the connection alive.
 *
 * Gated by `authMiddleware` (global) only. Developer Mode is NOT required
 * to view the live tail.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ObservabilityApiContext } from './index.js';

const POLL_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 15000;

export function streamRouter(ctx: ObservabilityApiContext): Router {
  const r = Router();

  r.get('/stream', (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string | undefined;
    const traceId = req.query.traceId as string | undefined;

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');

    let eventId = 0;
    const send = (event: string, data: unknown): void => {
      try {
        res.write(`id: ${eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        eventId++;
      } catch { /* connection closed */ }
    };

    send('connected', { timestamp: new Date().toISOString(), sessionId, traceId });

    // ── 1. Telemetry bus events ──────────────────────────────────────────────
    let telemetryBus: { onEvent: (h: (ev: { sessionId?: string; metadata?: Record<string, unknown> }) => void) => () => void } | undefined;
    try {
      telemetryBus = ctx.api.getEngine().telemetry as unknown as typeof telemetryBus;
    } catch { /* engine not ready */ }

    const unsubTelemetry = telemetryBus?.onEvent((ev) => {
      // Filter by sessionId if provided (and the event carries one).
      if (sessionId && ev.sessionId && ev.sessionId !== sessionId) return;
      // Filter by traceId if provided (carried in metadata.traceId).
      if (traceId && ev.metadata?.['traceId'] && ev.metadata['traceId'] !== traceId) return;
      send('telemetry', ev);
    });

    // ── 2. Poll for new spans + logs every 2s ────────────────────────────────
    let lastSeenTs = new Date().toISOString();
    const pollTimer = setInterval(async () => {
      try {
        // Fetch recent logs (last 2s window) — cheap probe for "something happened".
        const logs = await ctx.store.getLogs({
          from: lastSeenTs,
          session_id: sessionId,
          trace_id: traceId,
          limit: 50,
        });
        if (logs.length > 0) {
          for (const l of logs) {
            send('log', l);
          }
          // Advance the watermark to the newest log ts.
          const newest = logs[0]!.ts;
          if (newest > lastSeenTs) lastSeenTs = newest;
        }
      } catch { /* ignore poll errors — connection may be closing */ }
    }, POLL_INTERVAL_MS);

    // ── 3. Heartbeat every 15s ───────────────────────────────────────────────
    const heartbeat = setInterval(() => {
      try {
        res.write(`:heartbeat ${Date.now()}\n\n`);
      } catch { /* connection closed */ }
    }, HEARTBEAT_INTERVAL_MS);

    // ── Cleanup on disconnect ────────────────────────────────────────────────
    req.on('close', () => {
      clearInterval(pollTimer);
      clearInterval(heartbeat);
      unsubTelemetry?.();
      res.end();
    });
  });

  return r;
}
