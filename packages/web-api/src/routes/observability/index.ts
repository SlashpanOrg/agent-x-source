/**
 * Observability API router (§9.1, §9.6).
 *
 * Mounts all sub-routers under `/api/observability/*`. All endpoints are gated
 * by `authMiddleware` (applied globally before this router is mounted).
 *
 * Developer Mode gating:
 *   - Data endpoints (traces, logs, metrics, health, stream, export, alerts
 *     GET, cost GET, session traces) are accessible to any authenticated user.
 *   - Config endpoints (config GET/PUT, purge, alerts resolve POST) are gated
 *     by `requireDeveloperMode` — these are sensitive settings that require
 *     root password verification.
 *   - The dev-mode status/verify/enable/disable endpoints are NOT gated by dev
 *     mode (they're needed to unlock it in the first place).
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ApiContext } from '../../services/ApiService.js';
import type { ObservabilityHandle } from '@agentx/engine';
import type { ObservabilityStore } from '@agentx/engine';
import { tracesRouter } from './traces.js';
import { logsRouter } from './logs.js';
import { metricsRouter } from './metrics.js';
import { configRouter, purgeRouter } from './config.js';
import { alertsRouter, costRouter } from './alerts.js';
import { devRouter } from './dev.js';
import { healthRouter } from './health.js';
import { exportRouter } from './export.js';
import { streamRouter } from './stream.js';

/**
 * Context passed to every observability sub-router. Extends the base
 * {@link ApiContext} with the observability store + handle.
 */
export interface ObservabilityApiContext extends ApiContext {
  store: ObservabilityStore;
  handle: ObservabilityHandle;
}

/**
 * Build the observability router. The `store` and `handle` are obtained from
 * `getObservabilityHandle()` at mount time in `index.ts`; if observability is
 * not initialized (e.g. storage deferred), the router returns 503 for all
 * data endpoints.
 */
export function observabilityRouter(ctx: ObservabilityApiContext): Router {
  const r = Router();

  // Dev-mode endpoints — NOT gated by requireDeveloperMode (needed to unlock).
  r.use('/dev', devRouter(ctx));

  // Data endpoints — accessible to any authenticated user (no dev mode).
  r.use('/traces', tracesRouter(ctx));
  r.use('/logs', logsRouter(ctx));
  r.use('/metrics', metricsRouter(ctx));
  r.use('/alerts', alertsRouter(ctx));
  r.use('/cost', costRouter(ctx));
  r.use('/health', healthRouter(ctx));
  r.use('/', streamRouter(ctx));

  // Config endpoints — gated by requireDeveloperMode (sensitive settings).
  r.use('/config', configRouter(ctx));
  r.use('/purge', purgeRouter(ctx));

  // Trace export — data endpoint (no dev mode). Mounted at the top level
  // because it handles /traces/:traceId/export paths.
  r.use('/', exportRouter(ctx));

  // Session traces — GET /sessions/:sessionId/traces (data endpoint, no dev mode).
  r.get('/sessions/:sessionId/traces', async (req: Request, res: Response) => {
    try {
      const sessionId = req.params.sessionId as string;
      const traces = await ctx.store.listTraces({ session_id: sessionId });
      res.json({ traces });
    } catch {
      res.status(500).json({ error: 'internal', message: 'Failed to list session traces' });
    }
  });

  return r;
}
