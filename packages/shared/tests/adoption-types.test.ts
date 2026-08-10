import { describe, it, expect } from 'vitest';
import { createIdleGoalState } from '@agentx/shared';
import type { HarnessEntry } from '@agentx/shared';

describe('adoption type serialization', () => {
  it('round-trips goal state JSON', () => {
    const goal = createIdleGoalState();
    const parsed = JSON.parse(JSON.stringify(goal));
    expect(parsed.status).toBe('idle');
  });

  it('round-trips harness entry JSON', () => {
    const entry: HarnessEntry = {
      id: 'm1',
      kind: 'memory',
      title: 'T',
      content: 'C',
      path: '',
      reference: {},
      arguments: {},
      metadata: {},
      source: 'test',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      version: 1,
    };
    const parsed = JSON.parse(JSON.stringify(entry)) as HarnessEntry;
    expect(parsed.title).toBe('T');
  });
});
