import type { AutomationTaskRecord } from '@agentx/shared';
import { AUTOMATION_RUN_LEAD_MS } from './constants.js';

/** One catch-up run max when a recurring tick was missed but a run already covered the slot. */
export function isMissedTickCoalesced(
  task: AutomationTaskRecord,
  targetRunAt?: string,
): boolean {
  if (!targetRunAt || task.scheduleType !== 'recurring') return false;
  const targetMs = new Date(targetRunAt).getTime();
  if (Number.isNaN(targetMs)) return false;
  const overdueMs = Date.now() - targetMs;
  if (overdueMs < 60_000) return false;
  const lastRunMs = task.lastRunAt ? new Date(task.lastRunAt).getTime() : 0;
  if (!lastRunMs) return false;
  return lastRunMs >= targetMs - AUTOMATION_RUN_LEAD_MS;
}
