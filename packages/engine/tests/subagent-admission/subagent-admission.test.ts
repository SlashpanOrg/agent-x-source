import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AgentXConfig } from '@agentx/shared';
import { configureAdoptionFromConfig } from '@agentx/shared';
import { SubAgentAdmissionManager } from '../../src/subagent-admission/SubAgentAdmissionManager.js';

describe('SubAgentAdmissionManager', () => {
  afterEach(() => {
    configureAdoptionFromConfig(null);
  });

  it('blocks when admission disabled', () => {
    configureAdoptionFromConfig(null);
    const mgr = new SubAgentAdmissionManager();
    expect(mgr.isEnabled()).toBe(false);
    expect(mgr.reserveSlot()).toEqual({ ok: false, reason: 'Subagent admission is disabled.' });
  });

  it('reserves slots up to capacity when enabled', () => {
    configureAdoptionFromConfig({
      adoption: { subagentAdmission: { enabled: true } },
    } as AgentXConfig);
    const mgr = new SubAgentAdmissionManager();
    expect(mgr.isEnabled()).toBe(true);

    for (let i = 0; i < 4; i++) {
      expect(mgr.reserveSlot()).toEqual({ ok: true });
      mgr.register({
        taskId: `task-${i}`,
        childSessionId: `child-${i}`,
        status: 'admitted',
        admittedAt: new Date().toISOString(),
      });
    }
    const blocked = mgr.reserveSlot();
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.reason).toContain('capacity');
    }
  });

  it('transitions admitted → running → complete', () => {
    configureAdoptionFromConfig({
      adoption: { subagentAdmission: { enabled: true } },
    } as AgentXConfig);
    const mgr = new SubAgentAdmissionManager();
    mgr.register({
      taskId: 't1',
      childSessionId: 'c1',
      status: 'admitted',
      admittedAt: new Date().toISOString(),
    });
    mgr.markRunning('t1');
    expect(mgr.listActive()[0]?.status).toBe('running');
    mgr.complete('t1', 'completed');
    expect(mgr.listActive()).toHaveLength(0);
  });
});
