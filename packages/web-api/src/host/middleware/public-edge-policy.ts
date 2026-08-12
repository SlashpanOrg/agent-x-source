import type { Request, Response, NextFunction } from 'express';
import type { HostExposureScope } from '@agentx/shared';
import { metricsRegistry } from '../../metrics/MetricsRegistry.js';
import { tryGetHostGateway } from '../HostGateway.js';

/**
 * Public-edge route policy.
 *
 * Deny-by-default for sensitive surfaces (observability, jobs, metrics, dev).
 * When Host → “Expose web UI” is on, the authenticated app SPA + `/api/*`
 * (minus denylist) are reachable through the tunnel. When web is off, only a
 * narrow telephony/voice/host surface remains.
 */

/** Always denied on the public edge — never exposed via tunnel. */
export const PUBLIC_EDGE_DENYLIST: RegExp[] = [
  /^\/api\/observability/,
  /^\/observability/,
  /^\/api\/jobs/,
  /^\/metrics/,
  /^\/api\/dev/,
];

/**
 * Minimal surface always allowed when the tunnel is up (health probes, auth
 * bootstrap, host controls). Used when web exposure is off.
 */
export const PUBLIC_EDGE_BASE_ALLOWLIST: RegExp[] = [
  /^\/$/,
  /^\/assets\//,
  /^\/favicon/,
  /^\/index\.html$/,
  /^\/api\/health$/,
  /^\/api\/auth\//,
  /^\/api\/host\//,
  /^\/api\/config$/,
];

/** @deprecated Prefer isPublicEdgePathAllowed(path, exposure). Kept for callers/tests. */
export const PUBLIC_EDGE_ALLOWLIST: RegExp[] = [
  ...PUBLIC_EDGE_BASE_ALLOWLIST,
  /^\/api\/telephony\//,
  /^\/api\/voice\//,
  /^\/api\/sessions/,
  /^\/ws/,
  /^\/voice-ws/,
];

export function isPublicEdgePathAllowed(
  pathname: string,
  exposure?: HostExposureScope | null,
): boolean {
  if (PUBLIC_EDGE_DENYLIST.some((re) => re.test(pathname))) return false;

  const webOn = exposure?.web !== false; // default: web UI exposed when tunnel is on
  const voiceOn = Boolean(exposure?.voice);
  const telOn = Boolean(exposure?.telephonyWebhooks);

  if (PUBLIC_EDGE_BASE_ALLOWLIST.some((re) => re.test(pathname))) return true;

  if (webOn) {
    // Authenticated web UI over the tunnel: SPA routes + APIs except denylist.
    return true;
  }

  // Web off — narrow surface for telephony / browser-voice only.
  if (telOn && /^\/api\/telephony\//.test(pathname)) return true;
  if (
    voiceOn &&
    (/^\/api\/voice\//.test(pathname) || /^\/voice-ws/.test(pathname) || /^\/ws/.test(pathname))
  ) {
    return true;
  }
  if (/^\/api\/sessions/.test(pathname)) return true;

  return false;
}

/**
 * True when the request likely arrived through a public tunnel
 * (presence of ngrok/cf forwarded headers or HostGateway active).
 */
export function looksLikePublicEdgeRequest(headers: Record<string, unknown>): boolean {
  const markers = [
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-forwarded-host',
    'ngrok-agent-ips',
    'cf-connecting-ip',
  ];
  return markers.some((h) => headers[h] != null || headers[h.toLowerCase()] != null);
}

/** Reduced-cardinality path label for metrics (avoid raw-path explosion / PII in label values). */
export function edgeMetricPathLabel(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean).slice(0, 3);
  return parts.length ? `/${parts.join('/')}` : '/';
}

/** True when the active HostGateway tunnel is currently serving public traffic. */
function isTunnelActive(): { active: boolean; https: boolean } {
  const gateway = tryGetHostGateway();
  if (!gateway) return { active: false, https: false };
  const status = gateway.getTunnelStatus();
  return { active: status.state === 'active', https: status.protocol === 'https' };
}

/**
 * Global guard applied early in the middleware chain.
 *
 * Path allowlist/denylist applies ONLY to traffic that actually arrived through
 * a public tunnel (forwarding headers from ngrok/cloudflare/etc.). Local
 * Electron / loopback clients must keep full API access even while a tunnel is
 * running — previously `tunnelActive` incorrectly forced the allowlist on every
 * request and broke the desktop app with `{"error":"not_found"}`.
 */
export function publicEdgeGuard(req: Request, res: Response, next: NextFunction): void {
  const gateway = tryGetHostGateway();
  const { https: tunnelHttps } = isTunnelActive();
  const fromPublicTunnel = looksLikePublicEdgeRequest(req.headers as Record<string, unknown>);

  // Baseline hardening headers — cheap, safe to set on every response.
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=(), usb=(), microphone=(self)');

  const forwardedProto = req.headers['x-forwarded-proto'];
  const isHttps =
    (typeof forwardedProto === 'string' && forwardedProto.split(',')[0]?.trim() === 'https') ||
    (fromPublicTunnel && tunnelHttps);
  if (isHttps) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }

  if (!fromPublicTunnel) {
    next();
    return;
  }

  const pathname = req.path;
  const exposure = gateway?.getConfig()?.exposure ?? null;
  if (!isPublicEdgePathAllowed(pathname, exposure)) {
    const reason = PUBLIC_EDGE_DENYLIST.some((re) => re.test(pathname)) ? 'denylist' : 'not_allowlisted';
    metricsRegistry.incrementCounter('host_public_requests_rejected_total', {
      reason,
      path_group: edgeMetricPathLabel(pathname),
    });
    res.status(404).json({ error: 'not_found' });
    return;
  }

  next();
}
