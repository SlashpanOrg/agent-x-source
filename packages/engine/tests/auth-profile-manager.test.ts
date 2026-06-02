import { describe, it, expect } from 'vitest';
import { AuthProfileManager } from '../src/providers/AuthProfileManager.js';

describe('AuthProfileManager', () => {
  const manager = new AuthProfileManager();

  it('adds and retrieves credentials', async () => {
    manager.addCredential('openai', 'sk-test-key');
    const cred = await manager.getCredential('openai');
    expect(cred).toBe('sk-test-key');
  });

  it('rotates credentials', () => {
    const mgr = new AuthProfileManager();
    mgr.addCredential('provider1', 'key-1');
    mgr.addCredential('provider1', 'key-2');
    expect(mgr.canRotate('provider1')).toBe(true);
  });

  it('cannot rotate single credential', () => {
    const mgr = new AuthProfileManager();
    mgr.addCredential('provider2', 'only-key');
    expect(mgr.canRotate('provider2')).toBe(false);
  });

  it('throws for unknown provider', async () => {
    const mgr = new AuthProfileManager();
    await expect(mgr.getCredential('unknown')).rejects.toThrow();
  });

  it('returns profile and provider counts', () => {
    const mgr = new AuthProfileManager();
    mgr.addCredential('p1', 'k1');
    mgr.addCredential('p1', 'k2');
    mgr.addCredential('p2', 'k3');
    expect(mgr.getProviderCount()).toBe(2);
    expect(mgr.getProfileCount('p1')).toBe(2);
  });
});
