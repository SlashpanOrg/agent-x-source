import { Router } from 'express';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { getExecutableSkillRegistry } from '@agentx/engine';
import { getLogger } from '@agentx/shared';
import { getEngine } from '../engine.js';
import { getActiveWorkspacePath } from '../workspace.js';

export function createExecutableSkillsRouter(): Router {
  const r = Router();

  r.get('/api/executable-skills', (_req, res) => {
    try {
      const eng = getEngine();
      const workspace = getActiveWorkspacePath(eng.configManager.load());
      const registry = getExecutableSkillRegistry();
      const skills = registry.discover({ workspacePath: workspace });
      res.json({ skills });
    } catch (e) {
      getLogger().error('GET_EXECUTABLE_SKILLS', e instanceof Error ? e : String(e));
      res.status(500).json({ error: 'Failed to list skills' });
    }
  });

  r.post('/api/executable-skills/install', (req, res) => {
    try {
      const sourcePath = String(req.body?.path ?? '').trim();
      if (!sourcePath || !existsSync(sourcePath)) {
        res.status(400).json({ error: 'valid path required' });
        return;
      }
      const skillMd = join(sourcePath, 'SKILL.md');
      if (!existsSync(skillMd)) {
        res.status(400).json({ error: 'SKILL.md not found in path' });
        return;
      }
      const globalRoot = join(homedir(), '.agent-x', 'skills');
      const dest = join(globalRoot, basename(sourcePath));
      mkdirSync(globalRoot, { recursive: true });
      cpSync(sourcePath, dest, { recursive: true });
      const eng = getEngine();
      const workspace = getActiveWorkspacePath(eng.configManager.load());
      const skills = getExecutableSkillRegistry().discover({ workspacePath: workspace });
      res.json({ ok: true, installedTo: dest, skills });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : 'install failed' });
    }
  });

  return r;
}
