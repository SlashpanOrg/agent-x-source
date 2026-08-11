import { describe, it, expect, afterEach } from 'vitest';
import { configureAdoptionFromConfig, setAdoptionTurnOverrides } from '@agentx/shared';
import { SessionLeaseManager } from '../../src/session-lease/SessionLeaseManager.js';

describe('SessionLeaseManager', () => {
  afterEach(() => {
    setAdoptionTurnOverrides(null);
    configureAdoptionFromConfig(null);
  });

  it('returns true when leases disabled (no pool)', async () => {
    setAdoptionTurnOverrides({ sessionLease: false });
    const mgr = new SessionLeaseManager();
    expect(mgr.isEnabled()).toBe(false);
    const ok = await mgr.acquire('sess-1');
    expect(ok).toBe(true);
  });
});
