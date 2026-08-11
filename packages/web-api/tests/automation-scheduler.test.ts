import { describe, it, expect } from 'vitest';
import { isMissedTickCoalesced } from '../src/automation/run-coalesce.js';
import type { AutomationTaskRecord } from '@agentx/shared';
import {
  tryClaimAutomationTask,
  releaseAutomationTaskClaim,
} from '@agentx/engine';

function baseTask(overrides: Partial<AutomationTaskRecord> = {}): AutomationTaskRecord {
  return {
    id: 'task-1',
    displayId: 'ax_auto_test',
    taskKey: null,
    title: 'Test',
    instruction: 'Do thing',
    scheduleType: 'recurring',
    cronExpression: '0 * * * *',
    runAt: null,
    timezone: 'UTC',
    status: 'active',
    sourceChannel: 'web',
    sourceSessionId: 'sess-1',
    notifyChannels: ['in_app'],
    permissionSnapshot: null,
    pgbossJobId: null,
    pgbossScheduleName: null,
    lastRunAt: null,
    lastRunStatus: null,
    nextRunAt: null,
    runCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('isMissedTickCoalesced', () => {
  it('returns false when target is recent', () => {
    const target = new Date(Date.now() - 30_000).toISOString();
    expect(isMissedTickCoalesced(baseTask(), target)).toBe(false);
  });

  it('returns true when last run covered the missed slot', () => {
    const targetMs = Date.now() - 120_000;
    const target = new Date(targetMs).toISOString();
    const task = baseTask({ lastRunAt: new Date(targetMs + 1000).toISOString() });
    expect(isMissedTickCoalesced(task, target)).toBe(true);
  });
});

describe('tryClaimAutomationTask', () => {
  it('claims when row is free', async () => {
    const state = { claimed: false, holder: null as string | null, status: 'active' };
    const pool = {
      async query(text: string, values?: unknown[]) {
        if (text.includes('UPDATE automation_tasks')) {
          if (!state.claimed || state.holder === values?.[1]) {
            state.claimed = true;
            state.holder = values?.[1] as string;
            return { rowCount: 1, rows: [] };
          }
          return { rowCount: 0, rows: [] };
        }
        if (text.includes('claimed_at = NULL')) {
          state.claimed = false;
          state.holder = null;
          return { rowCount: 1, rows: [] };
        }
        if (text.includes('SELECT status')) {
          return { rowCount: 1, rows: [{ status: state.status }] };
        }
        return { rowCount: 0, rows: [] };
      },
    };
    const first = await tryClaimAutomationTask(pool, 'task-1', 'run-a');
    expect(first.ok).toBe(true);
    const second = await tryClaimAutomationTask(pool, 'task-1', 'run-b');
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('held_by_other');
    await releaseAutomationTaskClaim(pool, 'task-1', 'run-a');
    state.claimed = false;
    state.holder = null;
    const third = await tryClaimAutomationTask(pool, 'task-1', 'run-b');
    expect(third.ok).toBe(true);
  });
});
