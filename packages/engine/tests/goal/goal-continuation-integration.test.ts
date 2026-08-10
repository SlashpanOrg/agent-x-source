import { describe, it, expect } from 'vitest';

describe('goal multi-continuation (P1-GOL-INT-11)', () => {
  it('GoalService exposes continuation prompt when active', async () => {
    const { getGoalService } = await import('../../src/goal/GoalService.js');
    const goal = getGoalService();
    expect(typeof goal.buildContinuationPrompt).toBe('function');
  });
});
