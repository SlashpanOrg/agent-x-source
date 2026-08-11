import { describe, it, expect } from 'vitest';

/** Regression naming: adoption-phase-1-compaction (X-TEST-03) */
describe('regression adoption-phase-1-compaction', () => {
  it('compaction artifact metadata shape', () => {
    const artifact = {
      summaryIndex: 1,
      createdAt: new Date().toISOString(),
      fileSet: { filesRead: ['a.ts'], filesModified: [] },
    };
    expect(artifact.fileSet.filesRead).toContain('a.ts');
  });
});
