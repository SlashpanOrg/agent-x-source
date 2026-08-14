import { describe, it, expect } from 'vitest';
import { hostExposureLabel, hostExposureIsPublic } from '../src/components/settings/host-exposure';

describe('Host exposure UI states (H7.18)', () => {
  it('labels every exposure state', () => {
    expect(hostExposureLabel('LOCAL_ONLY')).toBe('Local only');
    expect(hostExposureLabel('LAN_REACHABLE')).toBe('LAN reachable');
    expect(hostExposureLabel('PUBLIC_DIRECT_UNSAFE')).toContain('unsafe');
    expect(hostExposureLabel('PUBLIC_TUNNEL_SECURED')).toContain('Tunnel');
    expect(hostExposureLabel('DEGRADED')).toBe('Degraded');
    expect(hostExposureLabel('DISABLED')).toBe('Disabled');
    expect(hostExposureLabel('UNKNOWN')).toBe('Unknown');
  });

  it('flags public postures', () => {
    expect(hostExposureIsPublic('PUBLIC_TUNNEL_SECURED')).toBe(true);
    expect(hostExposureIsPublic('LOCAL_ONLY')).toBe(false);
  });
});
