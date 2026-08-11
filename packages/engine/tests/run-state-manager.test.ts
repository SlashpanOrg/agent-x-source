import { describe, it, expect } from 'vitest';
import { RunStateManager } from '../src/agent/RunStateManager.js';

describe('RunStateManager', () => {
  it('tracks a running session', async () => {
    const mgr = new RunStateManager();
    const signal = await mgr.ensureRunning('s1');
    expect(mgr.isRunning('s1')).toBe(true);
    expect(signal.aborted).toBe(false);
    mgr.release('s1');
    expect(mgr.isRunning('s1')).toBe(false);
  });

  it('rejects double ensureRunning on same session', async () => {
    const mgr = new RunStateManager();
    await mgr.ensureRunning('s2');
    await expect(mgr.ensureRunning('s2')).rejects.toThrow();
    mgr.release('s2');
  });

  it('cancel aborts signal', async () => {
    const mgr = new RunStateManager();
    const signal = await mgr.ensureRunning('s3');
    mgr.cancel('s3');
    expect(signal.aborted).toBe(true);
    expect(mgr.isRunning('s3')).toBe(false);
  });

  it('isCancelled reflects abort', async () => {
    const mgr = new RunStateManager();
    const signal = await mgr.ensureRunning('s4');
    mgr.cancel('s4');
    expect(mgr.isCancelled('s4')).toBe(true);
    expect(signal.aborted).toBe(true);
  });

  it('tracks multiple sessions independently', async () => {
    const mgr = new RunStateManager();
    await mgr.ensureRunning('a');
    await mgr.ensureRunning('b');
    expect(mgr.getRunningCount()).toBe(2);
    mgr.cancelAll();
    expect(mgr.getRunningCount()).toBe(0);
  });
});
