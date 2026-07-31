/**
 * Metrics endpoints (§9.2).
 *
 *   GET /api/observability/metrics        — time-series aggregated into buckets
 *   GET /api/observability/metrics/names  — distinct metric names
 *
 * The time-series endpoint accepts `name`, `from`, `to`, `step` (Postgres
 * date_trunc unit, default 'hour'), and `domain` (filters by labels->>'domain').
 *
 * Data endpoint — accessible to any authenticated user. Developer Mode is NOT
 * required to view observability data.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ObservabilityApiContext } from './index.js';
import type { ObservabilityDomain } from '@agentx/shared';

export function metricsRouter(ctx: ObservabilityApiContext): Router {
  const r = Router();

  // GET /metrics — time-series for a single metric name.
  r.get('/', async (req: Request, res: Response) => {
    try {
      const name = req.query.name as string | undefined;
      if (!name) {
        res.status(400).json({ error: 'bad-request', message: 'Query parameter "name" is required' });
        return;
      }
      const domain = req.query.domain as ObservabilityDomain | undefined;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const step = (req.query.step as string | undefined) ?? 'hour';

      const series = await ctx.store.getMetricSeries(
        name,
        domain ? { domain } : {},
        from,
        to,
        step,
      );

      if (!series) {
        res.status(404).json({ error: 'not-found', message: 'Metric not found' });
        return;
      }
      res.json(series);
    } catch {
      res.status(500).json({ error: 'internal', message: 'Failed to get metric series' });
    }
  });

  // GET /metrics/names — distinct metric names, optionally filtered by domain.
  r.get('/names', async (req: Request, res: Response) => {
    try {
      const domain = req.query.domain as ObservabilityDomain | undefined;
      const names = await ctx.store.listMetricNames(domain);
      res.json({ names });
    } catch {
      res.status(500).json({ error: 'internal', message: 'Failed to list metric names' });
    }
  });

  return r;
}
