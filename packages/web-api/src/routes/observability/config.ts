/**
 * Config + purge endpoints (§9.2).
 *
 *   GET  /api/observability/config  — current observability config
 *   PUT  /api/observability/config  — update retention_days / capture_prompts / enabled / OTLP / alerting
 *   POST /api/observability/purge   — purgeAll() with confirm body { confirm: true }
 *
 * These are **config endpoints** — gated by `requireDeveloperMode` because they
 * expose and modify sensitive settings (OTLP credentials, retention, capture
 * prompts, alerting thresholds). Data endpoints (traces, logs, metrics, etc.)
 * are NOT gated by dev mode.
 *
 * The purge route is mounted at the top level (/api/observability/purge) in
 * index.ts, not under /config.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ObservabilityApiContext } from './index.js';
import { requireDeveloperMode } from '../../middleware/dev-mode.js';
import type { ObservabilityConfig } from '@agentx/shared';

export function configRouter(ctx: ObservabilityApiContext): Router {
  const r = Router();
  r.use(requireDeveloperMode);

  // GET / — current config (mounted at /config, so this is GET /api/observability/config).
  r.get('/', async (_req: Request, res: Response) => {
    try {
      const config = await ctx.store.getConfig();
      if (!config) {
        res.status(404).json({ error: 'not-found', message: 'Observability config not found' });
        return;
      }
      res.json(config);
    } catch {
      res.status(500).json({ error: 'internal', message: 'Failed to get config' });
    }
  });

  // PUT / — update config fields.
  r.put('/', async (req: Request, res: Response) => {
    try {
      const patch: Partial<ObservabilityConfig> = {};
      const body = req.body as Record<string, unknown>;

      if (typeof body['retention_days'] === 'number') {
        const days = Math.floor(body['retention_days']);
        if (days < 1 || days > 90) {
          res.status(400).json({ error: 'bad-request', message: 'retention_days must be between 1 and 90' });
          return;
        }
        patch.retention_days = days;
      }
      if (typeof body['capture_prompts'] === 'boolean') {
        patch.capture_prompts = body['capture_prompts'];
      }
      if (typeof body['enabled'] === 'boolean') {
        patch.enabled = body['enabled'];
      }
      // OTLP external collector (v1.1+)
      if (typeof body['otlp_enabled'] === 'boolean') {
        patch.otlp_enabled = body['otlp_enabled'];
      }
      if (typeof body['otlp_endpoint'] === 'string') {
        patch.otlp_endpoint = body['otlp_endpoint'];
      }
      if (body['otlp_protocol'] === 'http' || body['otlp_protocol'] === 'grpc') {
        patch.otlp_protocol = body['otlp_protocol'];
      }
      if (body['otlp_headers'] != null && typeof body['otlp_headers'] === 'object') {
        patch.otlp_headers = body['otlp_headers'] as Record<string, string>;
      }
      // Alerting (v1.1+)
      if (typeof body['alerting_enabled'] === 'boolean') {
        patch.alerting_enabled = body['alerting_enabled'];
      }
      if (typeof body['alerting_error_rate_pct'] === 'number') {
        const pct = Math.floor(body['alerting_error_rate_pct']);
        if (pct < 1 || pct > 100) {
          res.status(400).json({ error: 'bad-request', message: 'alerting_error_rate_pct must be 1-100' });
          return;
        }
        patch.alerting_error_rate_pct = pct;
      }
      if (typeof body['alerting_latency_p95_ms'] === 'number') {
        const ms = Math.floor(body['alerting_latency_p95_ms']);
        if (ms < 100 || ms > 600000) {
          res.status(400).json({ error: 'bad-request', message: 'alerting_latency_p95_ms must be 100-600000' });
          return;
        }
        patch.alerting_latency_p95_ms = ms;
      }
      if (typeof body['alerting_window_minutes'] === 'number') {
        const min = Math.floor(body['alerting_window_minutes']);
        if (min < 1 || min > 1440) {
          res.status(400).json({ error: 'bad-request', message: 'alerting_window_minutes must be 1-1440' });
          return;
        }
        patch.alerting_window_minutes = min;
      }

      if (Object.keys(patch).length === 0) {
        res.status(400).json({ error: 'bad-request', message: 'No valid config fields to update' });
        return;
      }

      const updated = await ctx.store.updateConfig(patch);
      if (!updated) {
        res.status(404).json({ error: 'not-found', message: 'Observability config not found' });
        return;
      }

      // Trigger handle.reloadConfig() so the tracer/sampler/purger/OTLP pick up the change.
      await ctx.handle.reloadConfig();

      res.json(updated);
    } catch {
      res.status(500).json({ error: 'internal', message: 'Failed to update config' });
    }
  });

  return r;
}

/**
 * Purge router — mounted at /api/observability/purge (top-level, not under /config).
 * Gated by requireDeveloperMode.
 */
export function purgeRouter(ctx: ObservabilityApiContext): Router {
  const r = Router();
  r.use(requireDeveloperMode);

  // POST / — purgeAll() with confirm body { confirm: true }.
  r.post('/', async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown> | undefined;
      if (!body || body['confirm'] !== true) {
        res.status(400).json({ error: 'bad-request', message: 'Body must be { confirm: true }' });
        return;
      }
      await ctx.store.purgeAll();
      res.json({ purged: true });
    } catch {
      res.status(500).json({ error: 'internal', message: 'Failed to purge' });
    }
  });

  return r;
}
