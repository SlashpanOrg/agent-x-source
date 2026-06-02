import { describe, it, expect } from 'vitest';
import { RunStateManager } from '../src/agent/RunStateManager.js';

describe('RunStateManager', () => {
  it('ensures single session run', () => {
    const mgr = new RunStateManager();
    expect(mgr.isRunning('s1')).toBe(false);
    const signal = mgr.ensureRunning('s1');
    expect(mgr.isRunning('s1')).toBe(true);
    expect(signal.aborted).toBe(false);
  });

  it('prevents duplicate runs on same session', () => {
    const mgr = new RunStateManager();
    mgr.ensureRunning('s2');
    expect(() => mgr.ensureRunning('s2')).toThrow();
  });

  it('cancels a running session', () => {
    const mgr = new RunStateManager();
    const signal = mgr.ensureRunning('s3');
    mgr.cancel('s3');
    expect(signal.aborted).toBe(true);
    expect(mgr.isRunning('s3')).toBe(false);
  });

  it('releases session without aborting', () => {
    const mgr = new RunStateManager();
    const signal = mgr.ensureRunning('s4');
    mgr.release('s4');
    expect(mgr.isRunning('s4')).toBe(false);
    expect(signal.aborted).toBe(false);
  });

  it('lists running sessions', () => {
    const mgr = new RunStateManager();
    mgr.ensureRunning('a');
    mgr.ensureRunning('b');
    expect(mgr.getRunningCount()).toBe(2);
    expect(mgr.getRunningSessions()).toContain('a');
    mgr.cancelAll();
    expect(mgr.getRunningCount()).toBe(0);
  });
});
