import {
  isHarnessEnabled,
  getHarnessAutoRefineSettings,
  getLogger,
} from '@agentx/shared';
import { getGoalService } from '../goal/GoalService.js';
import { getHarnessService } from './HarnessService.js';
import type { Agent } from '../agent/Agent.js';

export type AutoRefineReason = 'compaction' | 'interval';

const intervalTurnCounters = new Map<string, number>();

function shouldSkipAutoRefine(agent: Agent): boolean {
  if (!isHarnessEnabled()) return true;
  if (agent.isCompactionInFlight()) return true;
  if (getHarnessService().isRefineInFlight(agent.sessionId)) return true;
  if (agent.isSessionPausedForUserInput?.()) return true;
  const goal = getGoalService().getStatus(agent.sessionId);
  if (goal.status === 'paused') return true;
  return false;
}

/**
 * Schedule harness auto-refine using the same plan/apply pipeline as manual refine.
 */
export function reviewAutoRefine(agent: Agent, reason: AutoRefineReason): void {
  const settings = getHarnessAutoRefineSettings();
  if (reason === 'compaction' && !settings.onCompaction) return;
  if (reason === 'interval') {
    const n = settings.intervalTurns;
    if (!n || n <= 0) return;
  }
  if (shouldSkipAutoRefine(agent)) return;

  setTimeout(() => {
    if (shouldSkipAutoRefine(agent)) return;
    void agent.refineHarness(
      reason === 'compaction'
        ? 'Auto-refine after context compaction — update harness memories and routing hints from recent trajectory.'
        : 'Auto-refine on turn interval — update harness memories and routing hints from recent trajectory.',
    ).then((result) => {
      if (!result.ok) {
        getLogger().warn('AUTO_REFINE', `${agent.sessionId}: ${result.error ?? 'failed'}`);
      }
    }).catch((e) => {
      getLogger().warn('AUTO_REFINE', e instanceof Error ? e.message : String(e));
    });
  }, 500);
}

export function trackTurnForAutoRefine(agent: Agent): void {
  const settings = getHarnessAutoRefineSettings();
  const interval = settings.intervalTurns ?? 0;
  if (!interval || interval <= 0) return;
  if (shouldSkipAutoRefine(agent)) return;

  const counter = (intervalTurnCounters.get(agent.sessionId) ?? 0) + 1;
  if (counter >= interval) {
    intervalTurnCounters.set(agent.sessionId, 0);
    reviewAutoRefine(agent, 'interval');
  } else {
    intervalTurnCounters.set(agent.sessionId, counter);
  }
}
