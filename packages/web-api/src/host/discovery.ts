import type {
  HostAddressInfo,
  HostExposureState,
  HostNetworkSnapshot,
  TunnelStatus,
} from '@agentx/shared';
import { networkInterfaces } from 'node:os';

const CGNAT_PREFIX = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;

export function classifyIPv4(address: string, internal: boolean): HostAddressInfo['scope'] {
  if (internal || address.startsWith('127.')) return 'loopback';
  if (address.startsWith('169.254.')) return 'link_local';
  if (CGNAT_PREFIX.test(address)) return 'cgnat';
  const parts = address.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return 'unknown';
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  return 'public';
}

export function classifyIPv6(address: string, internal: boolean): HostAddressInfo['scope'] {
  const lower = address.toLowerCase();
  if (internal || lower === '::1') return 'loopback';
  if (lower.startsWith('fe80:')) return 'link_local';
  if (lower.startsWith('fc') || lower.startsWith('fd')) return 'private'; // ULA RFC4193
  return 'public';
}

export function collectHostAddresses(): HostAddressInfo[] {
  let nets: ReturnType<typeof networkInterfaces> = {};
  try {
    nets = networkInterfaces() ?? {};
  } catch {
    nets = {};
  }
  const out: HostAddressInfo[] = [];
  for (const [interfaceName, entries] of Object.entries(nets)) {
    for (const net of entries ?? []) {
      const familyRaw = net.family as string | number;
      const family: 'IPv4' | 'IPv6' =
        familyRaw === 6 || familyRaw === 'IPv6' ? 'IPv6' : 'IPv4';
      const scope =
        family === 'IPv4'
          ? classifyIPv4(net.address, net.internal)
          : classifyIPv6(net.address, net.internal);
      out.push({
        address: net.address,
        family,
        scope,
        internal: net.internal,
        interfaceName,
      });
    }
  }
  return out;
}

/**
 * Best-effort public IP discovery via a third-party echo service. Disabled
 * entirely via `AGENTX_PUBLIC_IP_DISCOVERY=0`. Never throws — returns `null`
 * on any network error, non-2xx response, timeout, or malformed body.
 * Confidence is always `unverified` (an external service told us, we didn't
 * independently confirm reachability from outside our own network).
 */
export async function fetchPublicIp(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 2000,
): Promise<string | null> {
  if (process.env['AGENTX_PUBLIC_IP_DISCOVERY'] === '0') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl('https://api.ipify.org?format=json', { signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { ip?: unknown };
    return typeof data.ip === 'string' && data.ip.trim() ? data.ip.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Strip host-internal detail (network interface name) from addresses before
 * they leave the process toward a non-local caller. `interfaceName` values
 * like `en0`/`eth0` are internal topology detail with no value to a remote
 * client and unnecessary information disclosure over the public edge.
 */
export function redactAddressesForRemote(addresses: HostAddressInfo[]): HostAddressInfo[] {
  return addresses.map((addr) => {
    const { interfaceName: _interfaceName, ...rest } = addr;
    return rest;
  });
}

export function buildNetworkSnapshot(options: {
  bindHost: string;
  bindPort: number;
  publicIp?: string | null;
}): HostNetworkSnapshot {
  const addresses = collectHostAddresses();
  const lanUrls: string[] = [];
  for (const addr of addresses) {
    if (addr.family !== 'IPv4') continue;
    if (addr.scope === 'private' || addr.scope === 'cgnat') {
      lanUrls.push(`http://${addr.address}:${options.bindPort}`);
    }
  }
  const hasCgnat = addresses.some((a) => a.scope === 'cgnat');
  const hasPublicIface = addresses.some((a) => a.scope === 'public' && !a.internal);

  return {
    bindHost: options.bindHost,
    bindPort: options.bindPort,
    loopbackUrl: `http://127.0.0.1:${options.bindPort}`,
    lanUrls,
    addresses: addresses.map((a) => ({
      ...a,
      // Redact full interface inventory for remote clients later; keep local detail for now.
    })),
    publicIp: options.publicIp ?? null,
    publicIpConfidence: options.publicIp ? 'unverified' : 'none',
    natUncertainty: hasCgnat || (!hasPublicIface && lanUrls.length > 0),
  };
}

export function deriveExposureState(input: {
  publicAccess: boolean;
  tunnel: TunnelStatus;
  network: HostNetworkSnapshot;
  emergencyDisabled?: boolean;
}): HostExposureState {
  if (input.emergencyDisabled) return 'DISABLED';

  const tunnelState = input.tunnel.state;
  if (tunnelState === 'error') return 'DEGRADED';

  if (tunnelState === 'active' && input.tunnel.publicUrl) {
    return 'PUBLIC_TUNNEL_SECURED';
  }

  const bind = input.network.bindHost;
  const isLoopbackBind = bind === '127.0.0.1' || bind === '::1' || bind === 'localhost';
  const hasPublicIface = input.network.addresses.some((a) => a.scope === 'public' && !a.internal);

  if (!isLoopbackBind && hasPublicIface) {
    return 'PUBLIC_DIRECT_UNSAFE';
  }
  if (!isLoopbackBind && input.network.lanUrls.length > 0) {
    return 'LAN_REACHABLE';
  }
  if (isLoopbackBind) return 'LOCAL_ONLY';
  return 'UNKNOWN';
}
