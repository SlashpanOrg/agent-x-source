/**
 * Alerts + cost analytics endpoints (v1.1+).
 *
 *   GET  /api/observability/alerts          — list recent alerts (data: no dev mode)
 *   POST /api/observability/alerts/:id/resolve — resolve an alert (config: dev mode)
 *   GET  /api/observability/cost/daily      — cost rollup (data: no dev mode)
 *
 * Data endpoints (GET) are accessible to any authenticated user. The resolve
 * endpoint (POST) is a modifying action gated by Developer Mode.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ObservabilityApiContext } from './index.js';
import { requireDeveloperMode } from '../../middleware/dev-mode.js';

export function alertsRouter(ctx: ObservabilityApiContext): Router {
  const r = Router();

  // GET / — list alerts (query: ?resolved=true for resolved only).
  // Data endpoint — no dev mode required.
  r.get('/', async (req: Request, res: Response) => {
    try {
      const resolved = req.query.resolved === 'true';
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 500);
      const alerts = await ctx.store.listAlerts(resolved, limit);
      res.json({ alerts });
    } catch {
      res.status(500).json({ error: 'internal', message: 'Failed to list alerts' });
    }
  });

  // POST /:id/resolve — mark an alert as resolved.
  // Modifying action — gated by Developer Mode.
  r.post('/:id/resolve', requireDeveloperMode, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'bad-request', message: 'Invalid alert id' });
        return;
      }
      await ctx.store.resolveAlert(id);
      res.json({ resolved: true });
    } catch {
      res.status(500).json({ error: 'internal', message: 'Failed to resolve alert' });
    }
  });

  return r;
}

export function costRouter(ctx: ObservabilityApiContext): Router {
  const r = Router();

  // GET /daily — cost rollup by day/provider/model (query: ?days=30).
  // Data endpoint — no dev mode required.
  r.get('/daily', async (req: Request, res: Response) => {
    try {
      const days = Math.min(parseInt(req.query.days as string, 10) || 30, 365);
      const rows = await ctx.store.getCostRollup(days);
      res.json({ rows });
    } catch {
      res.status(500).json({ error: 'internal', message: 'Failed to get cost rollup' });
    }
  });

  return r;
}
