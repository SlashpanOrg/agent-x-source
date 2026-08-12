import type { Request, Response, NextFunction } from 'express';
import { getLogger } from '@agentx/shared';
import { getTelephonyService, type TelephonyProviderAdapter } from '@agentx/engine';
import { tryGetHostGateway } from '../../host/HostGateway.js';

const REPLAY_WINDOW_MS = 5 * 60 * 1000;
const seenEventIds = new Map<string, number>();

function pruneReplayCache(now = Date.now()): void {
  for (const [id, ts] of seenEventIds) {
    if (now - ts > REPLAY_WINDOW_MS) seenEventIds.delete(id);
  }
}

export interface TelephonyWebhookLocals {
  providerId: string;
  adapter: TelephonyProviderAdapter;
  rawBody: Buffer;
}

/**
 * Plug-n-play webhook middleware:
 * 1. Resolve adapter by :providerId (no vendor branching)
 * 2. Verify signature via adapter
 * 3. Reject replayed provider event ids when present
 */
export function telephonyWebhookAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const providerId = String(req.params['providerId'] ?? '').trim();
  if (!providerId) {
    res.status(400).json({ error: 'provider_required' });
    return;
  }

  const service = getTelephonyService();
  const adapter = service.getRegistry().get(providerId);
  if (!adapter) {
    res.status(404).json({ error: 'unknown_provider' });
    return;
  }

  const host = tryGetHostGateway();
  const exposure = host?.getConfig().exposure;
  if (host && !exposure?.telephonyWebhooks) {
    res.status(403).json({ error: 'telephony_webhooks_disabled' });
    return;
  }

  const credentials = service.getCredentials(providerId);
  const rawBody = captureRawBody(req);
  const url = absoluteWebhookUrl(req);

  const verification = adapter.verifyWebhook({
    url,
    method: req.method,
    headers: req.headers as Record<string, string | string[] | undefined>,
    rawBody,
    credentials,
  });

  if (!verification.ok) {
    getLogger().warn('TELEPHONY_WEBHOOK_REJECTED', 'Signature verification failed', {
      providerId,
      reason: verification.reason,
    });
    res.status(401).json({ error: 'invalid_signature', reason: verification.reason });
    return;
  }

  const eventId = extractEventId(req.body);
  if (eventId) {
    pruneReplayCache();
    const key = `${providerId}:${eventId}`;
    if (seenEventIds.has(key)) {
      res.status(409).json({ error: 'replay' });
      return;
    }
    seenEventIds.set(key, Date.now());
  }

  (res.locals as { telephony?: TelephonyWebhookLocals }).telephony = {
    providerId,
    adapter,
    rawBody,
  };
  next();
}

function captureRawBody(req: Request): Buffer {
  const anyReq = req as Request & { rawBody?: Buffer | string };
  if (Buffer.isBuffer(anyReq.rawBody)) return anyReq.rawBody;
  if (typeof anyReq.rawBody === 'string') return Buffer.from(anyReq.rawBody, 'utf8');
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  if (req.body && typeof req.body === 'object') {
    if (req.is('application/x-www-form-urlencoded')) {
      return Buffer.from(new URLSearchParams(flattenForm(req.body as Record<string, unknown>)).toString(), 'utf8');
    }
    return Buffer.from(JSON.stringify(req.body), 'utf8');
  }
  return Buffer.alloc(0);
}

function flattenForm(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] = v == null ? '' : String(v);
  }
  return out;
}

function absoluteWebhookUrl(req: Request): string {
  const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol ?? 'https');
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost');
  return `${proto}://${host}${req.originalUrl}`;
}

function extractEventId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const candidates = ['providerEventId', 'EventId', 'CallSid', 'SmsSid', 'MessageSid'];
  for (const key of candidates) {
    if (typeof b[key] === 'string' && b[key]) return String(b[key]);
  }
  return null;
}

/** Clear replay cache — tests only. */
export function __resetTelephonyReplayCache(): void {
  seenEventIds.clear();
}
