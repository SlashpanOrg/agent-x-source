import { Router } from 'express';
import type { Request, Response } from 'express';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync } from 'node:fs';
import { getLogger } from '@agentx/shared';
import { PromptBenchmarkService, type PromptBenchmarkProgressEvent, type PromptBenchmarkRunResult } from '@agentx/engine';
import { getEngine } from '../engine.js';

const logger = getLogger();
const service = new PromptBenchmarkService();

interface RunRequest {
  workspace?: string;
  fixturesPath?: string;
}

// In-memory store for completed runs, active streams, and event history
const runResults = new Map<string, PromptBenchmarkRunResult>();
const activeRuns = new Map<string, AbortController>();
const progressBus = new EventEmitter();
const runProgressHistory = new Map<string, PromptBenchmarkProgressEvent[]>();

export function createPromptBenchmarkRouter(): Router {
  const router = Router();

  router.post('/dev/prompt-benchmark', async (req: Request, res: Response) => {
    try {
      const { workspace, fixturesPath } = req.body as RunRequest;
      if (!workspace) {
        res.status(400).json({ error: 'workspace-required', message: 'Please select an isolated workspace folder.' });
        return;
      }
      if (!existsSync(workspace)) {
        try {
          mkdirSync(workspace, { recursive: true });
        } catch (e) {
          res.status(400).json({
            error: 'workspace-invalid',
            message: `Cannot create workspace: ${e instanceof Error ? e.message : String(e)}`,
          });
          return;
        }
      }

      const config = getEngine().configManager.load();
      const fixtures = fixturesPath ? service.loadFixtures(fixturesPath) : service.getDefaultFixtures();
      const runId = `pb-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const abortController = new AbortController();
      activeRuns.set(runId, abortController);

      res.status(202).json({ runId, total: fixtures.length });

      const startRun = async () => {
        try {
          const result = await service.run({
            runId,
            workspace,
            fixtures,
            config,
            modelId: config.provider.activeModel,
            signal: abortController.signal,
            onProgress: (event: PromptBenchmarkProgressEvent) => {
              logger.info('PROMPT_BENCHMARK', `${event.type}: ${event.fixtureId ?? ''}`);
              runProgressHistory.set(runId, [...(runProgressHistory.get(runId) ?? []), event]);
              progressBus.emit(runId, event);
            },
          });
          runResults.set(runId, result);
          activeRuns.delete(runId);
          runProgressHistory.delete(runId);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          logger.error('PROMPT_BENCHMARK', message);
          activeRuns.delete(runId);
          runProgressHistory.delete(runId);
          progressBus.emit(runId, { type: 'error', message } as PromptBenchmarkProgressEvent);
        }
      };

      void startRun();
    } catch (e) {
      logger.error('PROMPT_BENCHMARK_SETUP', e instanceof Error ? e.message : String(e));
      res.status(500).json({ error: 'benchmark-setup-failed', message: e instanceof Error ? e.message : String(e) });
    }
  });

  router.get('/dev/prompt-benchmark/:runId/stream', (req: Request, res: Response) => {
    const runId = req.params.runId;
    if (!runId) {
      res.status(400).json({ error: 'run-id-required' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(':ok\n\n');

    const result = runResults.get(runId);
    if (result) {
      res.write(`event: complete\ndata: ${JSON.stringify(result)}\n\n`);
      res.end();
      return;
    }

    if (!activeRuns.has(runId)) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'not-found' })}\n\n`);
      res.end();
      return;
    }

    const history = runProgressHistory.get(runId) ?? [];
    const listener = (event: PromptBenchmarkProgressEvent) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      if (event.type === 'complete' || event.type === 'error') {
        progressBus.off(runId, listener);
        runProgressHistory.delete(runId);
        res.end();
      }
    };

    for (const event of history) {
      listener(event);
    }
    progressBus.on(runId, listener);

    req.on('close', () => {
      progressBus.off(runId, listener);
    });
  });

  router.get('/dev/prompt-benchmark/:runId/result', (req: Request, res: Response) => {
    const runId = req.params.runId;
    if (!runId) {
      res.status(400).json({ error: 'run-id-required' });
      return;
    }
    const result = runResults.get(runId);
    if (!result) {
      res.status(404).json({ error: 'not-found' });
      return;
    }
    res.json(result);
  });

  return router;
}
