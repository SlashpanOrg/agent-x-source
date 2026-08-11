import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getGoalService } from '../../src/goal/GoalService.js';
import { existsSync, rmSync } from 'node:fs';
import { getSessionGoalPath } from '../../src/harness/paths.js';

describe('GoalService', () => {
  const sessionId = 'test-goal-session';

  afterEach(() => {
    const p = getSessionGoalPath(sessionId);
    if (existsSync(p)) rmSync(p, { force: true });
  });

  it('activates and completes a goal', () => {
    const svc = getGoalService();
    const active = svc.activate(sessionId, 'Ship harness MVP');
    expect(active.status).toBe('active');
    expect(active.objective).toBe('Ship harness MVP');
    const done = svc.complete(sessionId);
    expect(done.status).toBe('complete');
  });

  it('rejects illegal transition', () => {
    const svc = getGoalService();
    svc.clear(sessionId);
    expect(() => svc.pause(sessionId)).toThrow();
  });
});
