import { Router } from 'express';
import { getLogger, getAdoptionFeatureFlags } from '@agentx/shared';
import {
  getHarnessService,
  getGoalService,
  getSessionGenerationManager,
  getInterAgentMessageService,
} from '@agentx/engine';
import { getEngine, getOrCreateBoundSessionAgent } from '../engine.js';
import { buildSessionSnapshot } from '../adoption-snapshot.js';

export function createAdoptionRouter(): Router {
  const r = Router();

  r.get('/api/adoption/features', (_req, res) => {
    res.json(getAdoptionFeatureFlags());
  });

  r.get('/api/sessions/:sessionId/snapshot', async (req, res) => {
    try {
      const sessionId = String(req.params.sessionId);
      const snapshot = await buildSessionSnapshot(sessionId);
      res.json(snapshot);
    } catch (e) {
      getLogger().error('GET_SESSION_SNAPSHOT', e instanceof Error ? e : String(e));
      res.status(500).json({ error: 'Failed to build snapshot' });
    }
  });

  r.get('/api/sessions/:sessionId/events', async (req, res) => {
    try {
      const sessionId = String(req.params.sessionId);
      const clientGen = Number(req.query.generation ?? 0);
      const afterSequence = Number(req.query.afterSequence ?? 0);
      const currentGen = await getSessionGenerationManager().getGeneration(sessionId);
      if (clientGen !== currentGen) {
        res.status(409).json({
          error: 'generation_mismatch',
          currentGeneration: currentGen,
          clientGeneration: clientGen,
        });
        return;
      }
      const events = await getSessionGenerationManager().getEventsSince(sessionId, currentGen, afterSequence);
      res.json({ generation: currentGen, events });
    } catch (e) {
      getLogger().error('GET_SESSION_EVENTS', e instanceof Error ? e : String(e));
      res.status(500).json({ error: 'Failed to load events' });
    }
  });

  r.post('/api/sessions/:sessionId/agent-message', async (req, res) => {
    try {
      const fromSessionId = String(req.params.sessionId);
      const toSessionId = String(req.body?.toSessionId ?? '');
      const topic = String(req.body?.topic ?? 'message');
      const payload = (req.body?.payload as Record<string, unknown>) ?? {};
      const deliveryMode = req.body?.deliveryMode as 'auto' | 'steer' | 'follow_up' | undefined;
      const receiverRole = req.body?.receiverRole as 'parent' | 'sibling' | 'self' | undefined;
      if (!toSessionId) {
        res.status(400).json({ error: 'toSessionId required' });
        return;
      }
      const msg = await getInterAgentMessageService().enqueue(
        fromSessionId,
        toSessionId,
        topic,
        payload,
        deliveryMode ?? 'auto',
        receiverRole ?? 'sibling',
      );
      try {
        const eng = getEngine();
        const session = eng.sessionManager.getSessionById(toSessionId);
        if (session) {
          const agent = getOrCreateBoundSessionAgent(session);
          await agent.deliverInterAgentMessage(msg);
        }
      } catch (deliverErr) {
        getLogger().warn('AGENT_MESSAGE_DELIVER', deliverErr instanceof Error ? deliverErr.message : String(deliverErr));
      }
      res.json({ ok: true, message: msg });
    } catch (e) {
      if (e instanceof Error && e.message === 'sibling_messaging_not_allowed') {
        res.status(403).json({ error: 'sibling_messaging_not_allowed' });
        return;
      }
      res.status(500).json({ error: e instanceof Error ? e.message : 'send failed' });
    }
  });

  r.get('/api/sessions/:sessionId/agent-messages', async (req, res) => {
    try {
      const sessionId = String(req.params.sessionId);
      const messages = await getInterAgentMessageService().listPending(sessionId);
      res.json({ messages });
    } catch (e) {
      res.status(500).json({ error: 'Failed to load messages' });
    }
  });

  r.get('/api/harness/global', async (_req, res) => {
    try {
      const entries = await Promise.resolve(getHarnessService().listEntries('', 'global'));
      res.json({ entries });
    } catch (e) {
      res.status(500).json({ error: 'Failed to load global harness' });
    }
  });

  r.get('/api/sessions/:sessionId/harness/refinements', async (req, res) => {
    try {
      const sessionId = String(req.params.sessionId);
      const scope = (req.query.scope as string) === 'global' ? 'global' : 'local';
      const refinements = await Promise.resolve(getHarnessService().listRefinements(sessionId, scope));
      res.json({ refinements });
    } catch {
      res.status(500).json({ error: 'Failed to load refinements' });
    }
  });

  r.get('/api/sessions/:sessionId/harness', async (req, res) => {
    try {
      const sessionId = String(req.params.sessionId);
      const scope = (req.query.scope as string) === 'global' ? 'global' : 'local';
      const harness = getHarnessService();
      const entries = await Promise.resolve(harness.listEntries(sessionId, scope));
      res.json({ entries });
    } catch (e) {
      getLogger().error('GET_HARNESS', e instanceof Error ? e : String(e));
      res.status(500).json({ error: 'Failed to load harness' });
    }
  });

  r.post('/api/sessions/:sessionId/harness/refine', async (req, res) => {
    try {
      const sessionId = String(req.params.sessionId);
      const instructions = typeof req.body?.instructions === 'string' ? req.body.instructions : '';
      const scope = req.body?.scope === 'global' ? 'global' : 'local';
      const harness = getHarnessService();
      const eng = getEngine();
      const session = eng.sessionManager.getSessionById(sessionId);
      if (!session) {
        res.status(404).json({ ok: false, error: 'session_not_found' });
        return;
      }
      const agent = getOrCreateBoundSessionAgent(session);
      const store = eng.sessionManager.getStorageAdapter();
      const msgs = store?.getMessages ? await store.getMessages(sessionId) : [];
      const trajectory = msgs.slice(-24).map((m) => `${m.role}: ${String(m.content ?? '').slice(0, 500)}`).join('\n');

      const result = await harness.refine(sessionId, {
        scope,
        instructions,
        trajectorySummary: trajectory,
        complete: (prompt) => agent.runSimpleComplete(prompt),
      });

      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error });
        return;
      }
      res.json(result);
    } catch (e) {
      getLogger().error('POST_HARNESS_REFINE', e instanceof Error ? e : String(e));
      res.status(500).json({ ok: false, error: 'Refine failed' });
    }
  });

  r.post('/api/sessions/:sessionId/harness/rollback', async (req, res) => {
    try {
      const sessionId = String(req.params.sessionId);
      const rollbackId = String(req.body?.rollbackId ?? '');
      const scope = req.body?.scope === 'global' ? 'global' : 'local';
      const ok = await getHarnessService().rollback(sessionId, rollbackId, scope);
      if (ok) {
        void getSessionGenerationManager().bumpGeneration(sessionId, 'harness_rollback');
      }
      res.json({ ok });
    } catch (e) {
      getLogger().error('POST_HARNESS_ROLLBACK', e instanceof Error ? e : String(e));
      res.status(500).json({ ok: false });
    }
  });

  r.get('/api/sessions/:sessionId/goal', (req, res) => {
    try {
      const sessionId = String(req.params.sessionId);
      res.json(getGoalService().getStatus(sessionId));
    } catch (e) {
      res.status(500).json({ error: 'Failed to load goal' });
    }
  });

  r.post('/api/sessions/:sessionId/goal', (req, res) => {
    try {
      const sessionId = String(req.params.sessionId);
      const objective = String(req.body?.objective ?? '').trim();
      if (!objective) {
        res.status(400).json({ error: 'objective required' });
        return;
      }
      res.json(getGoalService().activate(sessionId, objective, req.body?.budget));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(400).json({ error: message });
    }
  });

  r.post('/api/sessions/:sessionId/goal/:action', (req, res) => {
    try {
      const sessionId = String(req.params.sessionId);
      const action = String(req.params.action);
      const goals = getGoalService();
      switch (action) {
        case 'pause':
          res.json(goals.pause(sessionId));
          break;
        case 'resume':
          res.json(goals.resume(sessionId));
          break;
        case 'complete':
          res.json(goals.complete(sessionId));
          break;
        case 'clear':
          res.json(goals.clear(sessionId));
          break;
        default:
          res.status(400).json({ error: 'unknown action' });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(400).json({ error: message });
    }
  });

  return r;
}
