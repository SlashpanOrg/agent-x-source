import { describe, it, expect } from 'vitest';
import { getQualityGateRunner } from '../../src/quality-gates/QualityGateRunner.js';

describe('QualityGateRunner', () => {
  it('passes when disabled or empty commands', async () => {
    const runner = getQualityGateRunner();
    const result = await runner.run({ commands: [] });
    expect(result.passed).toBe(true);
  });
});
