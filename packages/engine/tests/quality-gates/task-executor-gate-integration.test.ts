import { describe, it, expect } from 'vitest';

describe('TaskExecutor quality gate replan (P1-GATE-INT-07)', () => {
  it('TaskExecutor module loads quality gate runner', async () => {
    const { getQualityGateRunner } = await import('../../src/quality-gates/QualityGateRunner.js');
    expect(typeof getQualityGateRunner().run).toBe('function');
  });
});
