import { Router } from 'express';
import type { Request, Response } from 'express';
import { startAppSpan } from '@agentx/engine';
import type { ApiContext } from '../services/ApiService.js';

function withJobSpan(operation: string, fn: () => Promise<void>): Promise<void> {
  const { span, withContext } = startAppSpan(`job.${operation}`, 'job', 'job', {
    'job.operation': operation,
    'trace.domain': 'APP',
  });
  return withContext(async () => {
    try {
      await fn();
    } finally {
      span.end();
    }
  });
}

export function router(ctx: ApiContext): Router {
  const api = ctx.api;
  const r: Router = Router();

  r.post('/', async (req: Request, res: Response) => {
    await withJobSpan('enqueue', async () => {
      const { name, data, opts } = req.body as {
        name?: string;
        data?: unknown;
        opts?: { delay?: number; retries?: number; priority?: number };
      };
      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: 'name is required' });
        return;
      }
      const id = await api.getJobQueue().enqueue(name, data ?? {}, opts);
      res.json({ id });
    });
  });

  r.get('/:id', async (req: Request, res: Response) => {
    await withJobSpan('get', async () => {
      const id = req.params['id'];
      if (!id) {
        res.status(400).json({ error: 'id is required' });
        return;
      }
      const job = await api.getJobQueue().getJob(id);
      if (!job) {
        res.status(404).json({ error: 'not-found' });
        return;
      }
      res.json({ job });
    });
  });

  r.delete('/:id', async (req: Request, res: Response) => {
    await withJobSpan('cancel', async () => {
      const id = req.params['id'];
      if (!id) {
        res.status(400).json({ error: 'id is required' });
        return;
      }
      const cancelled = await api.getJobQueue().cancel(id);
      res.json({ cancelled });
    });
  });

  return r;
}
