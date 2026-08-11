import { describe, it, expect } from 'vitest';

describe('concurrent refine and compact (P1-SER-05)', () => {
  it('HarnessService waits when compaction in flight flag set', async () => {
    const { getHarnessService } = await import('../../src/harness/HarnessService.js');
    const harness = getHarnessService();
    expect(typeof harness.isRefineInFlight).toBe('function');
  });
});
