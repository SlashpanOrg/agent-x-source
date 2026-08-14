import type { Request, Response, NextFunction } from 'express';
import { metricsRegistry } from '../../metrics/MetricsRegistry.js';

/**
 * Simple in-memory sliding-window rate limiter.
 *
 * Not distributed — each process tracks its own buckets. Sufficient for a
 * single-instance host gateway; a shared store (Redis, etc.) would be
 * required for multi-instance deployments.
 */

export interface RateLimitOptions {
  /** Sliding window size in milliseconds. */
  windowMs: number;
  /** Max requests allowed per key within the window. */
  max: number;
  /** Derive the bucket key for a request. Return `null` to skip limiting (e.g. no session). */
  keyFn: (req: Request) => string | null;
  /** Label used for the `host_rate_limit_rejected_total{limiter}` metric and logs. */
  name: string;
  /** Response body message when the limit trips. */
  message?: string;
  /** HTTP status code to return when the limit trips. Defaults to 429. */
  statusCode?: number;
}

export interface RateLimiter {
  /** Express middleware enforcing the configured window/limit. */
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  /** Programmatic check (used by middleware and directly by tests). Records a hit when allowed. */
  check: (key: string) => boolean;
  /** Clear all tracked buckets (tests / logout). */
  reset: () => void;
}

interface Bucket {
  hits: number[];
}

function pruneBucket(bucket: Bucket, windowMs: number, now: number): void {
  const cutoff = now - windowMs;
  let i = 0;
  while (i < bucket.hits.length && (bucket.hits[i] ?? 0) < cutoff) i++;
  if (i > 0) bucket.hits.splice(0, i);
}

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const { windowMs, max, keyFn, name, statusCode = 429 } = options;
  const message = options.message ?? 'Too many requests. Please slow down.';
  const buckets = new Map<string, Bucket>();

  function check(key: string): boolean {
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { hits: [] };
      buckets.set(key, bucket);
    }
    pruneBucket(bucket, windowMs, now);
    if (bucket.hits.length >= max) {
      return false;
    }
    bucket.hits.push(now);
    return true;
  }

  function reset(): void {
    buckets.clear();
  }

  // Periodic sweep so long-idle keys don't sit in memory forever. Unref'd so
  // it never keeps the process alive (important for tests + graceful shutdown).
  const sweepInterval = setInterval(
    () => {
      const now = Date.now();
      for (const [key, bucket] of buckets) {
        pruneBucket(bucket, windowMs, now);
        if (bucket.hits.length === 0) buckets.delete(key);
      }
    },
    Math.max(windowMs, 60_000),
  );
  sweepInterval.unref?.();

  const middleware = (req: Request, res: Response, next: NextFunction): void => {
    const key = keyFn(req);
    if (key == null) {
      next();
      return;
    }
    if (!check(key)) {
      metricsRegistry.incrementCounter('host_rate_limit_rejected_total', { limiter: name });
      res.status(statusCode).json({ error: 'rate_limited', message });
      return;
    }
    next();
  };

  return { middleware, check, reset };
}

/** Extract the client IP, honoring a single-hop X-Forwarded-For (tunnel-terminated). */
export function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return (fwd.split(',')[0] ?? '').trim() || 'unknown';
  }
  const raw = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  return raw.replace(/^::ffff:/, '');
}

/** Session account key, when a session is attached (post-auth). */
function accountKey(req: Request): string | null {
  const username = req.agentxSession?.username;
  return username ? `acct:${username}` : null;
}

/** General API traffic — 600 requests / minute / IP (agent turn polling is chatty). */
export const publicApiRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 600,
  name: 'public_api',
  keyFn: (req) => `ip:${clientIp(req)}`,
});

/** Login attempts — 30 / 15 minutes / IP (automation + UI must coexist on localhost). */
export const loginRateLimit = createRateLimiter({
  windowMs: 15 * 60_000,
  max: 30,
  name: 'login',
  keyFn: (req) => `ip:${clientIp(req)}`,
  message: 'Too many login attempts. This IP is temporarily locked out — try again later.',
});

/** Per-account budget once a session is attached — 300 requests / minute / account. */
export const accountRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 300,
  name: 'account',
  keyFn: accountKey,
});

/** Provider webhook traffic — 60 requests / minute / IP. */
export const webhookRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 60,
  name: 'webhook',
  keyFn: (req) => `ip:${clientIp(req)}`,
});

/** Reset every prebuilt limiter's state (tests only). */
export function resetHostRateLimiters(): void {
  publicApiRateLimit.reset();
  loginRateLimit.reset();
  accountRateLimit.reset();
  webhookRateLimit.reset();
}
