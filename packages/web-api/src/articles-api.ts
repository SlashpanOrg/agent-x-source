import type { Express, Request, Response } from 'express';
import { getLogger } from '@agentx/shared';
import { getEngine, awaitStorageForApi } from './engine.js';
import { ArticleStore } from '@agentx/engine';
import { validate, createArticleSchema } from './validation.js';
import { broadcast } from './ws.js';

export function registerArticleRoutes(app: Express): void {
  app.get('/api/articles', async (req: Request, res: Response) => {
    try {
      const eng = getEngine();
      await awaitStorageForApi();
      if (!eng.pgPool) {
        res.json({ articles: [] });
        return;
      }
      const store = new ArticleStore(eng.pgPool);
      const sessionId = typeof req.query['session_id'] === 'string' ? req.query['session_id'] : undefined;
      const limit = Math.min(parseInt(String(req.query['limit'] ?? '50'), 10) || 50, 200);
      const offset = Math.max(0, parseInt(String(req.query['offset'] ?? '0'), 10) || 0);
      const records = sessionId
        ? await store.listForSession(sessionId, limit)
        : await store.list(limit, offset);
      res.json({ articles: records });
    } catch (e) {
      getLogger().error('GET_API_ARTICLES', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'list-failed' });
    }
  });

  app.get('/api/articles/:id', async (req: Request, res: Response) => {
    try {
      const eng = getEngine();
      await awaitStorageForApi();
      if (!eng.pgPool) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      const store = new ArticleStore(eng.pgPool);
      const payload = await store.getContent(req.params['id']!);
      if (!payload) {
        res.status(404).json({ error: 'article-not-found' });
        return;
      }
      res.json({
        article: payload.record,
        content: payload.content,
      });
    } catch (e) {
      getLogger().error('GET_API_ARTICLES_ID', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'get-failed' });
    }
  });

  app.post('/api/articles', validate(createArticleSchema), async (req: Request, res: Response) => {
    try {
      const eng = getEngine();
      await awaitStorageForApi();
      if (!eng.pgPool) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      const body = req.body as {
        sessionId: string;
        title?: string;
        content: string;
        kind?: string;
        messageId?: string;
        sourceRole?: 'user' | 'assistant' | 'system';
      };
      const store = new ArticleStore(eng.pgPool);
      const record = await store.create({
        sessionId: body.sessionId,
        title: body.title ?? '',
        content: body.content,
        kind: body.kind,
        messageId: body.messageId,
        sourceRole: body.sourceRole,
      });
      broadcast({ type: 'article_created', article: record });
      res.status(201).json({ article: record });
    } catch (e) {
      getLogger().error('POST_API_ARTICLES', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'create-failed' });
    }
  });

  app.delete('/api/articles/:id', async (req: Request, res: Response) => {
    try {
      const eng = getEngine();
      await awaitStorageForApi();
      if (!eng.pgPool) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      const store = new ArticleStore(eng.pgPool);
      const ok = await store.delete(req.params['id']!);
      res.json({ ok });
    } catch (e) {
      getLogger().error('DELETE_API_ARTICLES_ID', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'delete-failed' });
    }
  });
}
