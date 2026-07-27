/**
 * Traces endpoints (§9.2).
 *
 *   GET /api/observability/traces                    — paginated list with filters
 *   GET /api/observability/traces/:traceId           — full TraceDetail (tree + logs + metrics)
 *   GET /api/observability/traces/:traceId/spans     — flat span rows (waterfall without logs)
 *   GET /api/observability/traces/:traceId/logs      — logs for a trace (paginated)
 *   GET /api/observability/sessions/:sessionId/traces — traces for a session
 *
 * Data endpoints — accessible to any authenticated user (gated by global
 * authMiddleware only). Developer Mode is NOT required to view observability
 * data; it only gates the config UI (Settings → Developer tab).
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ObservabilityApiContext } from './index.js';
import type { ObservabilityDomain, TraceSummary, TraceKind } from '@agentx/shared';

export function tracesRouter(ctx: ObservabilityApiContext): Router {
  const r = Router();

  // GET /traces — paginated list with filters.
  r.get('/', async (req: Request, res: Response) => {
    try {
      const rawDomain = req.query.domain as string | undefined;
      const domain = rawDomain && rawDomain !== 'both' ? (rawDomain.toUpperCase() as ObservabilityDomain) : undefined;
      const sessionId = req.query.sessionId as string | undefined;
      const rawStatus = req.query.status as string | string[] | undefined;
      const rawKind = req.query.kind as string | string[] | undefined;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const q = req.query.q as string | undefined;
      const cursor = req.query.cursor as string | undefined;
      const limitRaw = parseInt(req.query.limit as string, 10);
      const limit = Number.isNaN(limitRaw) ? 50 : Math.min(Math.max(limitRaw, 1), 200);

      const toArray = (v: string | string[] | undefined): string[] | undefined => {
        if (v == null || v === '') return undefined;
        return Array.isArray(v) ? v : v.split(',').map((s) => s.trim()).filter(Boolean);
      };

      const traces = await ctx.store.listTraces({
        domain,
        session_id: sessionId,
        status: toArray(rawStatus) as TraceSummary['status'][] | undefined,
        kind: toArray(rawKind) as TraceKind[] | undefined,
        from,
        to,
        q,
        cursor,
        limit,
      });

      // Cursor for next page: started_at of the last trace (oldest in this page).
      const nextCursor = traces.length === limit && traces.length > 0
        ? traces[traces.length - 1]!.started_at
        : undefined;

      res.json({ traces, nextCursor });
    } catch (err) {
      res.status(500).json({ error: 'internal', message: 'Failed to list traces' });
      ctx.handle.store; // touch to avoid unused — error path
      void err;
    }
  });

  // GET /traces/:traceId — full TraceDetail (tree + logs + metrics).
  r.get('/:traceId', async (req: Request, res: Response) => {
    try {
      const traceId = req.params.traceId as string;
      const trace = await ctx.store.getTrace(traceId);
      if (!trace) {
        res.status(404).json({ error: 'not-found', message: 'Trace not found' });
        return;
      }
      res.json(trace);
    } catch {
      res.status(500).json({ error: 'internal', message: 'Failed to get trace' });
    }
  });

  // GET /traces/:traceId/spans — flat span rows (waterfall without logs).
  r.get('/:traceId/spans', async (req: Request, res: Response) => {
    try {
      const traceId = req.params.traceId as string;
      const spans = await ctx.store.getSpans(traceId);
      res.json({ spans });
    } catch {
      res.status(500).json({ error: 'internal', message: 'Failed to get spans' });
    }
  });

  // GET /traces/:traceId/logs — logs for a trace (paginated).
  r.get('/:traceId/logs', async (req: Request, res: Response) => {
    try {
      const traceId = req.params.traceId as string;
      const limitRaw = parseInt(req.query.limit as string, 10);
      const limit = Number.isNaN(limitRaw) ? 100 : Math.min(Math.max(limitRaw, 1), 1000);
      const cursor = req.query.cursor as string | undefined;
      const logs = await ctx.store.getLogs({ trace_id: traceId, limit, cursor });
      res.json({ logs });
    } catch {
      res.status(500).json({ error: 'internal', message: 'Failed to get trace logs' });
    }
  });

  return r;
}
