import { getLogger } from '@agentx/shared';

/**
 * Lightweight in-memory audit trail for host/public-edge lifecycle and
 * security events (tunnel start/stop, emergency stop, fail-closed startup,
 * rejected requests summaries, etc). Not a substitute for the observability
 * pipeline — this is a small, always-available ring buffer surfaced via
 * `GET /api/host/events` for operators without dev-mode/observability enabled.
 */

export type HostEventCategory = 'tunnel' | 'security' | 'startup' | 'shutdown' | 'auth' | 'system' | 'telephony';

export interface HostAuditEvent {
  id: string;
  timestamp: string;
  category: HostEventCategory;
  code: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface RecordHostEventInput {
  category: HostEventCategory;
  code: string;
  message: string;
  metadata?: Record<string, unknown>;
}

const MAX_EVENTS = 500;
const ringBuffer: HostAuditEvent[] = [];
let seq = 0;

export function recordHostEvent(input: RecordHostEventInput): HostAuditEvent {
  const event: HostAuditEvent = {
    id: `evt_${Date.now().toString(36)}_${(seq++).toString(36)}`,
    timestamp: new Date().toISOString(),
    category: input.category,
    code: input.code,
    message: input.message,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };

  ringBuffer.push(event);
  if (ringBuffer.length > MAX_EVENTS) {
    ringBuffer.splice(0, ringBuffer.length - MAX_EVENTS);
  }

  void appendToSecurityStoreIfAvailable(event);
  return event;
}

/** Most recent events, oldest-to-newest, capped at `limit` (default 100). */
export function listHostEvents(limit = 100): HostAuditEvent[] {
  const n = Math.max(0, Math.min(limit, ringBuffer.length));
  return n === 0 ? [] : ringBuffer.slice(ringBuffer.length - n);
}

/** Clear the ring buffer (tests only). */
export function clearHostEvents(): void {
  ringBuffer.length = 0;
  seq = 0;
}

/**
 * Best-effort mirror into a VoiceCallStore-style security event log, if the
 * running build exposes one. This is entirely optional plumbing for builds
 * that persist security events alongside call records — it must never throw
 * or block the caller (host lifecycle / request handling).
 */
async function appendToSecurityStoreIfAvailable(event: HostAuditEvent): Promise<void> {
  try {
    const mod: unknown = await import('@agentx/engine').catch(() => null);
    const getStore = (mod as { getVoiceCallStore?: () => unknown } | null)?.getVoiceCallStore;
    if (typeof getStore !== 'function') return;
    const store = getStore() as { recordSecurityEvent?: (_e: unknown) => void } | null | undefined;
    store?.recordSecurityEvent?.({
      source: 'host',
      category: event.category,
      code: event.code,
      message: event.message,
      metadata: event.metadata,
      timestamp: event.timestamp,
    });
  } catch (err) {
    getLogger().debug('HOST_AUDIT_STORE_APPEND_FAILED', 'Optional security-event mirror failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
