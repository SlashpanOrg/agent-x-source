/**
 * Health endpoint (§9.2).
 *
 *   GET /api/observability/health — { enabled, exporterQueueDepth, exporterDroppedCount, lastFlushAt, pgLatencyMs }
 *
 * Reports the span exporter's ring-buffer queue depth + dropped count, the
 * observability enabled flag, and a round-trip Postgres latency probe.
 *
 * Data endpoint — accessible to any authenticated user. Developer Mode is NOT
 * required to view observability health.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ObservabilityApiContext } from './index.js';
import { getSpanExporter } from '@agentx/engine';

export function healthRouter(ctx: ObservabilityApiContext): Router {
  const r = Router();

  r.get('/', async (_req: Request, res: Response) => {
    try {
      const exporter = getSpanExporter();
      const enabled = ctx.handle.isEnabled();

      // Probe Postgres latency with a trivial SELECT.
      let pgLatencyMs: number | undefined;
      try {
        const start = Date.now();
        await ctx.store.getConfig();
        pgLatencyMs = Date.now() - start;
      } catch {
        pgLatencyMs = undefined;
      }

      res.json({
        enabled,
        exporterQueueDepth: exporter ? (exporter as unknown as { ringBuffer?: unknown[] }).ringBuffer?.length ?? 0 : 0,
        exporterDroppedCount: exporter?.droppedCount ?? 0,
        lastFlushAt: undefined, // not tracked by the exporter in v1
        pgLatencyMs,
      });
    } catch {
      res.status(500).json({ error: 'internal', message: 'Failed to get health' });
    }
  });

  return r;
}
