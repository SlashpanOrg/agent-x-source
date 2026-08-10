import type { GoalBudget, GoalState, GoalStatus } from '@agentx/shared';
import { createIdleGoalState, isGoalsEnabled } from '@agentx/shared';
import { incrementAdoptionMetric } from '../adoption/adoption-metrics.js';
import { withSpan } from '../observability/tracer.js';
import { GoalStore } from './GoalStore.js';
import { buildGoalContinuationPrompt, buildGoalPromptBlock } from './goal-prompt.js';

const VALID_TRANSITIONS: Record<GoalStatus, GoalStatus[]> = {
  idle: ['active'],
  active: ['paused', 'complete', 'budget_limited', 'error', 'idle'],
  paused: ['active', 'idle', 'complete'],
  budget_limited: ['paused', 'complete', 'idle'],
  complete: ['idle', 'active'],
  error: ['idle', 'active'],
};

let goalServiceInstance: GoalService | null = null;

export function getGoalService(): GoalService {
  if (!goalServiceInstance) goalServiceInstance = new GoalService();
  return goalServiceInstance;
}

export class GoalService {
  private readonly store = new GoalStore();
  private readonly eventSink: Array<(event: Record<string, unknown>) => void> = [];

  onEvent(handler: (event: Record<string, unknown>) => void): void {
    this.eventSink.push(handler);
  }

  private emitStatus(sessionId: string, state: GoalState): void {
    const event = {
      type: 'goal_status_changed',
      sessionId,
      status: state.status,
      objective: state.objective,
    };
    for (const h of this.eventSink) {
      try { h(event); } catch { /* ignore */ }
    }
  }

  isEnabled(): boolean {
    return isGoalsEnabled();
  }

  getStatus(sessionId: string): GoalState {
    return this.store.read(sessionId);
  }

  getPromptBlock(sessionId: string): string {
    if (!this.isEnabled()) return '';
    return buildGoalPromptBlock(this.store.read(sessionId));
  }

  private transition(sessionId: string, next: GoalStatus, patch: Partial<GoalState> = {}): GoalState {
    const current = this.store.read(sessionId);
    const allowed = VALID_TRANSITIONS[current.status] ?? [];
    if (current.status !== next && !allowed.includes(next)) {
      throw new Error(`Invalid goal transition ${current.status} → ${next}`);
    }
    const merged: GoalState = { ...current, ...patch, status: next, updatedAt: new Date().toISOString() };
    if (next === 'complete') merged.completedAt = new Date().toISOString();
    if (next === 'active' && !merged.startedAt) merged.startedAt = new Date().toISOString();
    this.store.write(sessionId, merged);
    this.emitStatus(sessionId, merged);
    return merged;
  }

  activate(sessionId: string, objective: string, budget?: GoalBudget): GoalState {
    if (!this.isEnabled()) throw new Error('Goals are disabled for this turn');
    const current = this.store.read(sessionId);
    const base = current.status === 'idle' ? createIdleGoalState() : current;
    const next = this.transition(sessionId, 'active', {
      ...base,
      objective,
      budget: budget ?? base.budget,
      continuationsUsed: 0,
      tokensUsed: 0,
      startedAt: new Date().toISOString(),
      completedAt: undefined,
      error: undefined,
    });
    if (current.status === 'idle') incrementAdoptionMetric('goals_active');
    return next;
  }

  pause(sessionId: string): GoalState {
    return this.transition(sessionId, 'paused');
  }

  resume(sessionId: string): GoalState {
    return this.transition(sessionId, 'active');
  }

  complete(sessionId: string): GoalState {
    return this.transition(sessionId, 'complete');
  }

  clear(sessionId: string): GoalState {
    const prev = this.store.read(sessionId);
    const idle = createIdleGoalState();
    this.store.write(sessionId, idle);
    this.emitStatus(sessionId, idle);
    if (prev.status === 'active' || prev.status === 'paused') {
      incrementAdoptionMetric('goals_active', -1);
    }
    return idle;
  }

  recordContinuation(sessionId: string): GoalState {
    incrementAdoptionMetric('goal_continuations_total');
    return withSpan('goal.continuation', 'goal', () => {
      const current = this.store.read(sessionId);
      const next = { ...current, continuationsUsed: current.continuationsUsed + 1 };
      this.store.write(sessionId, next);
      return next;
    }, { 'session.id': sessionId });
  }

  shouldContinue(sessionId: string): boolean {
    if (!this.isEnabled()) return false;
    const goal = this.store.read(sessionId);
    if (goal.status !== 'active' || !goal.objective) return false;
    const max = goal.budget.maxContinuations;
    if (max != null && goal.continuationsUsed >= max) {
      this.transition(sessionId, 'budget_limited');
      return false;
    }
    return true;
  }

  buildContinuationPrompt(sessionId: string): string | null {
    if (!this.shouldContinue(sessionId)) return null;
    return buildGoalContinuationPrompt(this.store.read(sessionId));
  }
}

export { GoalFileStore } from './GoalStore.js';
