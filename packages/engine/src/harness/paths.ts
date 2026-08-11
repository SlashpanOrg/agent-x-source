import { join } from 'node:path';
import { getConfigDir, getDataDir } from '@agentx/shared';

export const HARNESS_STATE_FILE = 'harness_state.json';
export const REFINEMENTS_FILE = 'refinements.jsonl';
export const GOAL_STATE_FILE = 'goal_state.json';

export function getSessionHarnessDir(sessionId: string): string {
  return join(getDataDir(), 'sessions', sessionId, 'harness');
}

export function getGlobalHarnessDir(): string {
  return join(getConfigDir(), 'harness');
}

export function getSessionGoalPath(sessionId: string): string {
  return join(getDataDir(), 'sessions', sessionId, GOAL_STATE_FILE);
}
