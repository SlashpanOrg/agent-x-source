/**
 * Host tab exposure-state labeling — pure helper for UI tests (H7.18).
 */
export type HostExposureState =
  | 'LOCAL_ONLY'
  | 'LAN_REACHABLE'
  | 'PUBLIC_DIRECT_UNSAFE'
  | 'PUBLIC_TUNNEL_SECURED'
  | 'DEGRADED'
  | 'DISABLED'
  | 'UNKNOWN';

export function hostExposureLabel(state: HostExposureState | string): string {
  const map: Record<string, string> = {
    LOCAL_ONLY: 'Local only',
    LAN_REACHABLE: 'LAN reachable',
    PUBLIC_DIRECT_UNSAFE: 'Direct public (unsafe)',
    PUBLIC_TUNNEL_SECURED: 'Tunnel secured',
    DEGRADED: 'Degraded',
    DISABLED: 'Disabled',
    UNKNOWN: 'Unknown',
  };
  return map[state] ?? map.UNKNOWN!;
}

export function hostExposureIsPublic(state: HostExposureState | string): boolean {
  return state === 'PUBLIC_TUNNEL_SECURED' || state === 'PUBLIC_DIRECT_UNSAFE';
}
