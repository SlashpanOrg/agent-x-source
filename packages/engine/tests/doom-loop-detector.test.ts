import { describe, it, expect } from 'vitest';
import { DoomLoopDetector } from '../src/tools/DoomLoopDetector.js';

describe('DoomLoopDetector', () => {
  const detector = new DoomLoopDetector();

  it('returns false for first call', () => {
    const result = detector.check('sess-1', 'file_read', { path: 'test.ts' });
    expect(result.isDoomLoop).toBe(false);
    expect(result.consecutiveCount).toBe(1);
  });

  it('returns false for second identical call', () => {
    const d = new DoomLoopDetector();
    d.check('sess-1b', 'file_read', { path: 'test.ts' });
    const result = d.check('sess-1b', 'file_read', { path: 'test.ts' });
    expect(result.isDoomLoop).toBe(false);
    expect(result.consecutiveCount).toBe(2);
  });

  it('returns true after 3 consecutive identical calls', () => {
    detector.check('sess-1', 'file_read', { path: 'test.ts' });
    detector.check('sess-1', 'file_read', { path: 'test.ts' });
    const result = detector.check('sess-1', 'file_read', { path: 'test.ts' });
    expect(result.isDoomLoop).toBe(true);
    expect(result.shouldBreak).toBe(true);
  });

  it('resets counter when a different tool is called', () => {
    detector.reset('sess-2');
    detector.check('sess-2', 'file_read', { path: 'a.ts' });
    detector.check('sess-2', 'grep', { pattern: 'x' });
    const result = detector.check('sess-2', 'file_read', { path: 'b.ts' });
    expect(result.consecutiveCount).toBe(1);
  });

  it('resets per session', () => {
    detector.reset('sess-3');
    const result = detector.check('sess-3', 'shell_exec', { cmd: 'ls' });
    expect(result.isDoomLoop).toBe(false);
  });
});
