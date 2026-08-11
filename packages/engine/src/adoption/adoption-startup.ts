import { getCommandJournal } from '../command-journal/CommandJournal.js';
import { getDurableTurnStore } from '../durable-turn/DurableTurnStore.js';
import { getExecutableSkillRegistry } from '../executable-skills/ExecutableSkillRegistry.js';
import { isExecutableSkillsEnabled, isResidentSessionsEnabled } from '@agentx/shared';
import { incrementAdoptionMetric } from './adoption-metrics.js';
import { getResidentSessionManager } from '../resident/ResidentSessionManager.js';

/** Post-connect sweeps for durable adoption stores (Phase 2). */
export async function runAdoptionStartupSweeps(workspacePath?: string): Promise<void> {
  const stale = await getDurableTurnStore().sweepStaleOnStartup('fail_on_stale');
  if (stale > 0) incrementAdoptionMetric('durable_turns_stale_swept', stale);
  const uncertain = await getCommandJournal().sweepUncertain();
  if (uncertain > 0) incrementAdoptionMetric('command_journal_uncertain_total', uncertain);
  const active = await getDurableTurnStore().listActiveTurns();
  incrementAdoptionMetric('durable_turns_active', active.length);
  if (isExecutableSkillsEnabled()) {
    getExecutableSkillRegistry().discover({ workspacePath });
  }
  if (isResidentSessionsEnabled()) {
    getResidentSessionManager().startIdleSweep();
  }
}
