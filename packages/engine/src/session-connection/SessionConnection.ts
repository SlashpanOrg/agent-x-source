import type { EngineEvent, GoalState } from '@agentx/shared';

export interface SessionSnapshot {
  sessionId: string;
  messages?: unknown[];
  generation?: number;
}

export interface SessionConnection {
  readonly sessionId: string;

  sendMessage(content: string, options?: Record<string, unknown>): Promise<unknown>;
  cancel(): void;
  subscribeEvents(handler: (event: EngineEvent) => void): () => void;
  getSnapshot(): Promise<SessionSnapshot>;
  refineHarness(instructions?: string, scope?: 'local' | 'global'): Promise<{ ok: boolean; error?: string }>;
  getGoal(): GoalState;
  activateGoal(objective: string, budget?: Record<string, unknown>): GoalState;
  pauseGoal(): GoalState;
  resumeGoal(): GoalState;
  completeGoal(): GoalState;
  clearGoal(): GoalState;
}
