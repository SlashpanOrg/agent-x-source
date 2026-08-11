import { describe, it, expect } from 'vitest';
import { findLatestCompactionFileSet } from '../src/agent/agent-helpers.js';
import { CompactionFileTracker } from '../src/agent/CompactionFileTracker.js';

describe('compaction file tracking', () => {
  it('findLatestCompactionFileSet reads last artifact from message metadata', () => {
    const messages = [
      { metadata: { compactionArtifact: { fileSet: { filesRead: ['a.ts'], filesModified: [] } } } },
      { metadata: { compactionArtifact: { fileSet: { filesRead: ['b.ts'], filesModified: ['c.ts'] } } } },
    ];
    const latest = findLatestCompactionFileSet(messages);
    expect(latest?.filesRead).toEqual(['b.ts']);
    expect(latest?.filesModified).toEqual(['c.ts']);
  });

  it('CompactionFileTracker restore repopulates snapshot', () => {
    const tracker = new CompactionFileTracker();
    tracker.recordRead('x.ts');
    tracker.restore({ filesRead: ['y.ts'], filesModified: ['z.ts'] });
    const snap = tracker.snapshot();
    expect(snap.filesRead).toEqual(['y.ts']);
    expect(snap.filesModified).toEqual(['z.ts']);
  });
});
