import { Router } from 'express';
import { getResidentSessionManager } from '@agentx/engine';
import { getEngine, getOrCreateBoundSessionAgent } from '../engine.js';

export function createResidentSessionsRouter(): Router {
  const r = Router();
  const manager = getResidentSessionManager();

  r.get('/api/resident-sessions', (_req, res) => {
    if (!manager.isEnabled()) {
      res.json({ sessions: [], enabled: false });
      return;
    }
    res.json({ sessions: manager.list(), enabled: true });
  });

  r.post('/api/resident-sessions/:sessionId/detach', async (req, res) => {
    try {
      const sessionId = String(req.params.sessionId);
      if (!manager.isEnabled()) {
        res.status(400).json({ error: 'resident_sessions_disabled' });
        return;
      }
      const eng = getEngine();
      const session = eng.sessionManager.getSessionById(sessionId);
      if (session) {
        const agent = getOrCreateBoundSessionAgent(session);
        manager.register(sessionId, agent, 'active');
      }
      const ok = await manager.detach(sessionId);
      res.json({ ok });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : 'detach failed' });
    }
  });

  r.post('/api/resident-sessions/:sessionId/attach', async (req, res) => {
    try {
      const sessionId = String(req.params.sessionId);
      if (!manager.isEnabled()) {
        res.status(400).json({ error: 'resident_sessions_disabled' });
        return;
      }
      const eng = getEngine();
      const session = eng.sessionManager.getSessionById(sessionId);
      if (!session) {
        res.status(404).json({ error: 'session_not_found' });
        return;
      }
      let agent = await manager.attach(sessionId);
      if (!agent) {
        agent = getOrCreateBoundSessionAgent(session);
        manager.register(sessionId, agent, 'active');
      }
      if (eng.agent?.sessionId !== sessionId) {
        eng.agent = agent;
      }
      manager.touch(sessionId);
      res.json({ ok: true, sessionId });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : 'attach failed' });
    }
  });

  return r;
}
