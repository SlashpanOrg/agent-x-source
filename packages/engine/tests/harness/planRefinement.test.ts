import { describe, it, expect } from 'vitest';
import { planRefinement } from '../../src/harness/planRefinement.js';

describe('planRefinement', () => {
  it('parses JSON proposal from planner output', async () => {
    const raw = `Here is the plan:\n{"summary":"add memory","rationale":"test","edits":[{"action":"create","kind":"memory","title":"T","content":"C","reason":"r"}]}`;
    const { proposal } = await planRefinement({
      scope: 'local',
      sessionId: 's1',
      trajectorySummary: 'user asked for tests',
      complete: async () => raw,
    });
    expect(proposal?.summary).toBe('add memory');
    expect(proposal?.edits.length).toBe(1);
  });

  it('returns null proposal when planner output is invalid', async () => {
    const { proposal } = await planRefinement({
      scope: 'local',
      trajectorySummary: 'x',
      complete: async () => 'no json here',
    });
    expect(proposal).toBeNull();
  });
});
