import { describe, it, expect } from 'vitest';
import { SessionLeaseManager } from '../../src/session-lease/SessionLeaseManager.js';

describe('SessionLeaseManager', () => {
  it('returns true when leases disabled (no pool)', async () => {
    const mgr = new SessionLeaseManager();
    expect(mgr.isEnabled()).toBe(false);
    const ok = await mgr.acquire('sess-1');
    expect(ok).toBe(true);
  });
});
