/** Persistent goal FSM (Prime Agent adoption). */

export type GoalStatus =
  | 'idle'
  | 'active'
  | 'paused'
  | 'budget_limited'
  | 'complete'
  | 'error';

export interface GoalBudget {
  maxContinuations?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface GoalState {
  status: GoalStatus;
  objective: string;
  progress: Record<string, unknown>;
  budget: GoalBudget;
  continuationsUsed: number;
  tokensUsed: number;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

export interface GoalContinuationPolicy {
  enabled: boolean;
  promptTemplate?: string;
}

export function createIdleGoalState(): GoalState {
  return {
    status: 'idle',
    objective: '',
    progress: {},
    budget: {},
    continuationsUsed: 0,
    tokensUsed: 0,
    updatedAt: new Date().toISOString(),
  };
}
