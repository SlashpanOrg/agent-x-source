/**
 * Trace export endpoints (§9.7.4).
 *
 *   GET /api/observability/traces/:traceId/export?format=json|markdown
 *     — Download a self-contained trace bundle. Sets Content-Disposition: attachment.
 *   GET /api/observability/traces/:traceId/export/preview?format=json|markdown
 *     — Same bundle as text/plain (no Content-Disposition) for clipboard copy.
 *
 * Redaction: in v1, `?redact=false` is rejected unless `capture_prompts=true`
 * in the observability config (prevents PII bypass via export). The bundle's
 * spans/logs are redacted by `ObservabilityStore.getTraceExportBundle` based
 * on the live config.
 *
 * Data endpoint — accessible to any authenticated user. Developer Mode is NOT
 * required to export traces.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ObservabilityApiContext } from './index.js';
import { renderTraceBundleJson, renderTraceBundleMarkdown } from './export-renderers.js';

export function exportRouter(ctx: ObservabilityApiContext): Router {
  const r = Router();

  // GET /traces/:traceId/export — download (Content-Disposition: attachment).
  r.get('/traces/:traceId/export', async (req: Request, res: Response) => {
    await serveBundle(req, res, ctx, /* preview */ false);
  });

  // GET /traces/:traceId/export/preview — text/plain for clipboard copy.
  r.get('/traces/:traceId/export/preview', async (req: Request, res: Response) => {
    await serveBundle(req, res, ctx, /* preview */ true);
  });

  return r;
}

async function serveBundle(
  req: Request,
  res: Response,
  ctx: ObservabilityApiContext,
  preview: boolean,
): Promise<void> {
  try {
    const traceId = req.params.traceId as string;
    const format = ((req.query.format as string) ?? 'json').toLowerCase();
    const redactQuery = req.query.redact as string | undefined;

    if (format !== 'json' && format !== 'markdown') {
      res.status(400).json({ error: 'bad-request', message: 'format must be "json" or "markdown"' });
      return;
    }

    // v1: ?redact=false is rejected unless capture_prompts=true in config.
    if (redactQuery === 'false') {
      const config = await ctx.store.getConfig();
      if (!config?.capture_prompts) {
        res.status(400).json({ error: 'redaction-required', message: 'Unredacted export requires capture_prompts=true in the observability config.' });
        return;
      }
    }

    const bundle = await ctx.store.getTraceExportBundle(traceId);
    if (!bundle) {
      res.status(404).json({ error: 'not-found', message: 'Trace not found' });
      return;
    }

    const body = format === 'json'
      ? renderTraceBundleJson(bundle)
      : renderTraceBundleMarkdown(bundle);

    if (preview) {
      // Preview: text/plain, no Content-Disposition (for clipboard copy).
      res.set('Content-Type', 'text/plain; charset=utf-8');
      res.send(body);
    } else {
      // Download: set Content-Type + Content-Disposition: attachment.
      const ext = format === 'json' ? 'json' : 'md';
      res.set('Content-Type', format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="agentx-trace-${traceId}.${ext}"`);
      res.send(body);
    }
  } catch {
    res.status(500).json({ error: 'internal', message: 'Failed to export trace' });
  }
}
