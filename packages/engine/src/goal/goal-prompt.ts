import type { GoalState } from '@agentx/shared';
import { isGoalsEnabled } from '@agentx/shared';

export function buildGoalPromptBlock(goal: GoalState): string {
  if (!isGoalsEnabled() || goal.status !== 'active' || !goal.objective) return '';
  const budget = goal.budget;
  const budgetLine = [
    budget.maxContinuations != null ? `max continuations: ${budget.maxContinuations}` : '',
    budget.maxTokens != null ? `max tokens: ${budget.maxTokens}` : '',
    budget.timeoutMs != null ? `timeout ms: ${budget.timeoutMs}` : '',
  ].filter(Boolean).join(', ');
  return [
    `Status: ${goal.status}`,
    `Objective: ${goal.objective}`,
    budgetLine ? `Budget: ${budgetLine}` : '',
    `Continuations used: ${goal.continuationsUsed}`,
    'Continue working toward the objective. Mark complete via goal API when fully done.',
  ].filter(Boolean).join('\n');
}

export function buildGoalContinuationPrompt(goal: GoalState): string | null {
  if (goal.status !== 'active' || !goal.objective) return null;
  return [
    'GOAL CONTINUATION (host-driven):',
    `Objective: ${goal.objective}`,
    'No new user message — continue toward the objective with reasonable assumptions.',
    'When the objective is fully achieved, signal completion (goal complete).',
  ].join('\n');
}
