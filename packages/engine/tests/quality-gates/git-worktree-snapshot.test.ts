import { describe, it, expect } from 'vitest';
import { gitWorktreeSnapshot } from '../../src/quality-gates/git-worktree-snapshot.js';

describe('gitWorktreeSnapshot', () => {
  it('returns stable hash for empty non-repo cwd', () => {
    const snap = gitWorktreeSnapshot('/tmp');
    expect(snap.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(snap.status).toBe('');
    expect(snap.diff).toBe('');
  });
});
