/**
 * Logs endpoints (§9.2).
 *
 *   GET /api/observability/logs — log list with filters
 *
 * Filters: domain (APP|AGENT|both), sessionId, traceId, level, scope, from, to,
 * q, limit (default 100, max 1000), cursor (ts + id).
 *
 * Data endpoint — accessible to any authenticated user. Developer Mode is NOT
 * required to view observability data.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ObservabilityApiContext } from './index.js';
import type { ObservabilityDomain } from '@agentx/shared';

export function logsRouter(ctx: ObservabilityApiContext): Router {
  const r = Router();

  r.get('/', async (req: Request, res: Response) => {
    try {
      const domain = req.query.domain as ObservabilityDomain | undefined;
      const sessionId = req.query.sessionId as string | undefined;
      const traceId = req.query.traceId as string | undefined;
      const level = req.query.level as 'debug' | 'info' | 'warn' | 'error' | undefined;
      const scope = req.query.scope as string | undefined;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const q = req.query.q as string | undefined;
      const cursor = req.query.cursor as string | undefined;
      const limitRaw = parseInt(req.query.limit as string, 10);
      const limit = Number.isNaN(limitRaw) ? 100 : Math.min(Math.max(limitRaw, 1), 1000);

      let logs = await ctx.store.getLogs({
        domain: domain && domain !== ('both' as string) ? domain : undefined,
        session_id: sessionId,
        trace_id: traceId,
        level,
        scope,
        from,
        to,
        limit,
        cursor,
      });

      // Free-text filter on message (not in the SQL query — applied in-memory).
      if (q) {
        const ql = q.toLowerCase();
        logs = logs.filter((l: { message: string }) => l.message.toLowerCase().includes(ql));
      }

      const nextCursor = logs.length === limit && logs.length > 0
        ? String(logs[logs.length - 1]!.id)
        : undefined;

      res.json({ logs, nextCursor });
    } catch {
      res.status(500).json({ error: 'internal', message: 'Failed to list logs' });
    }
  });

  return r;
}
