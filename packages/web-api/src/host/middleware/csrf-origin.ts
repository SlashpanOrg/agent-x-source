import type { Request, Response, NextFunction } from 'express';
import { extractSessionTokenFromCookie, isTelephonyWebhookPath } from '../../auth.js';
import { metricsRegistry } from '../../metrics/MetricsRegistry.js';
import { edgeMetricPathLabel, looksLikePublicEdgeRequest } from './public-edge-policy.js';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Paths exempt from the Origin/Referer check even though they mutate state.
 * Login/setup happen before a session cookie exists, so there is nothing for
 * an attacker to ride via CSRF yet — brute-force protection is handled by
 * `loginRateLimit` instead. Kept narrow (exact path or nested sub-path only).
 */
const EXEMPT_PATH_PREFIXES = ['/api/auth/login', '/api/auth/setup'];

function isExemptPath(pathname: string): boolean {
  return EXEMPT_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function hostOf(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    // Referer/Origin without a scheme (rare, some proxies) — best-effort bare-host compare.
    return value.replace(/^\/+/, '').split('/')[0]?.toLowerCase() ?? null;
  }
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Require a same-origin Origin/Referer for cookie-authenticated, state-changing
 * requests that look like they arrived through the public edge. Bearer-token
 * clients (no session cookie) are not vulnerable to browser CSRF and are left
 * alone; telephony webhooks are signature-authenticated, not cookie-authenticated.
 */
export function csrfOriginGuard(req: Request, res: Response, next: NextFunction): void {
  if (!STATE_CHANGING_METHODS.has(req.method)) {
    next();
    return;
  }
  if (!looksLikePublicEdgeRequest(req.headers as Record<string, unknown>)) {
    next();
    return;
  }
  if (isTelephonyWebhookPath(req.path)) {
    next();
    return;
  }
  if (isExemptPath(req.path)) {
    next();
    return;
  }

  const cookieToken = extractSessionTokenFromCookie(req.headers.cookie);
  if (!cookieToken) {
    // No session cookie in play — not a cookie-auth request, CSRF does not apply.
    next();
    return;
  }

  const expectedHost = firstHeaderValue(req.headers['x-forwarded-host']) || req.headers.host;
  if (!expectedHost) {
    // No Host header to validate against — let auth/other middleware handle it.
    next();
    return;
  }

  const candidate = req.headers.origin ?? req.headers.referer;
  const candidateHost = typeof candidate === 'string' ? hostOf(candidate) : null;

  if (!candidateHost || candidateHost !== String(expectedHost).toLowerCase()) {
    metricsRegistry.incrementCounter('host_csrf_rejected_total', { path_group: edgeMetricPathLabel(req.path) });
    res.status(403).json({ error: 'origin_mismatch', message: 'Request origin does not match host.' });
    return;
  }

  next();
}
