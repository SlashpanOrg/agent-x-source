/**
 * Developer Mode auth gating (§9.3).
 *
 * Dev mode is a per-session flag that gates access to the observability data
 * endpoints (`/api/observability/*`). It is unlocked by verifying the root
 * password via `POST /api/observability/dev/verify`. The flag lives in memory
 * keyed by the auth session token — it is NOT persisted (a restart clears it,
 * forcing re-verification) and is separate from the regular auth session.
 */
import type { Request, Response, NextFunction } from 'express';
import { authManager } from '@agentx/shared';

/** Tokens that have unlocked developer mode in the current process. */
const devModeTokens = new Set<string>();

/** Tokens that have verified the root password (but may not have enabled dev mode yet). */
const devVerifiedTokens = new Set<string>();

/** Tracks failed verify attempts per IP for rate limiting (5 attempts / 5 min). */
interface RateLimitEntry {
  count: number;
  firstAttemptAt: number;
}
const verifyAttempts = new Map<string, RateLimitEntry>();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

/**
 * Extract the auth token from a request (cookie, Authorization header, or query for SSE).
 *
 * IMPORTANT: The session cookie set by `POST /api/auth/login` (see `auth.ts`) is
 * named `agentx_session`, NOT `session_token`. Using the wrong cookie name here
 * caused `extractToken` to always return `undefined` for requests that rely on
 * cookie auth (e.g. a freshly opened Observability window with no bearer token
 * in `sessionStorage`), which in turn made `/dev/verify` silently no-op and
 * `/dev/enable` always fail with "Verify the root password first."
 */
function extractToken(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  const cookie = req.headers.cookie;
  if (cookie) {
    const match = cookie.match(/(?:^|;\s*)agentx_session=([^;]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  const queryToken = req.query.token;
  if (typeof queryToken === 'string') return queryToken;
  return undefined;
}

/**
 * Express middleware: require developer mode for the matched route.
 * Returns `403 { error: 'developer-mode-required' }` if the session has not
 * unlocked dev mode. Must run AFTER `authMiddleware` so the token is validated.
 */
export function requireDeveloperMode(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token || !devModeTokens.has(token)) {
    res.status(403).json({ error: 'developer-mode-required', message: 'Developer mode is required to access observability data.' });
    return;
  }
  next();
}

/**
 * Mark the session (by token) as having unlocked developer mode.
 * When disabling, also clears the verified flag (disable is a full reset).
 */
export function setDevMode(req: Request, enabled: boolean): void {
  const token = extractToken(req);
  if (!token) return;
  if (enabled) {
    devModeTokens.add(token);
  } else {
    devModeTokens.delete(token);
    devVerifiedTokens.delete(token);
  }
}

/** Check whether the session (by token) has unlocked developer mode. */
export function isDevMode(req: Request): boolean {
  const token = extractToken(req);
  return !!token && devModeTokens.has(token);
}

/**
 * Mark the session (by token) as having verified the root password.
 * This is a prerequisite for `/dev/enable` — verify must precede enable.
 */
export function setDevVerified(req: Request, verified: boolean): void {
  const token = extractToken(req);
  if (!token) return;
  if (verified) {
    devVerifiedTokens.add(token);
  } else {
    devVerifiedTokens.delete(token);
  }
}

/** Check whether the session (by token) has verified the root password. */
export function isDevVerified(req: Request): boolean {
  const token = extractToken(req);
  return !!token && devVerifiedTokens.has(token);
}

/**
 * Clear all dev-mode + dev-verified flags for a specific token (used on logout).
 * If no token is provided, clears all flags (used on shutdown/testing).
 */
export function clearDevFlagsForToken(token?: string): void {
  if (token) {
    devModeTokens.delete(token);
    devVerifiedTokens.delete(token);
  } else {
    devModeTokens.clear();
    devVerifiedTokens.clear();
  }
}

/**
 * Rate limiter for `/dev/verify`. Returns true if the request is allowed,
 * false if it exceeds the limit (5 attempts / 5 min / IP).
 */
export function checkVerifyRateLimit(req: Request): boolean {
  const ip = (req.ip ?? req.socket?.remoteAddress ?? 'unknown').replace(/^::ffff:/, '');
  const now = Date.now();
  const entry = verifyAttempts.get(ip);
  if (!entry || now - entry.firstAttemptAt > RATE_LIMIT_WINDOW_MS) {
    verifyAttempts.set(ip, { count: 1, firstAttemptAt: now });
    return true;
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX) {
    return false;
  }
  return true;
}

/**
 * Verify the root password against the auth manager. Returns true on success.
 * Used by the `/dev/verify` endpoint — looks up the single root username
 * automatically so the caller only needs to supply the password.
 */
export async function verifyRootPassword(password: string): Promise<boolean> {
  const rootUsername = authManager.getRootUsername();
  if (!rootUsername) return false;
  try {
    await authManager.login(rootUsername, password);
    return true;
  } catch {
    return false;
  }
}

/** Clear all dev-mode + dev-verified tokens (used on shutdown or for testing). */
export function clearDevModeTokens(): void {
  devModeTokens.clear();
  devVerifiedTokens.clear();
  verifyAttempts.clear();
}
