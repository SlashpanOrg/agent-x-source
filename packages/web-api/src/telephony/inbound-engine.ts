import { randomUUID } from 'node:crypto';
import { getLogger, type NormalizedTelephonyEvent } from '@agentx/shared';
import {
  CallerPolicy,
  CallSessionStateMachine,
  createDefaultInboundMission,
  getTelephonyService,
  getVoiceCallStore,
  redactE164,
  type VoiceCallSession,
  type VoiceCallStore,
} from '@agentx/engine';
import { metricsRegistry } from '../metrics/MetricsRegistry.js';
import { tryGetHostGateway } from '../host/HostGateway.js';
import { recordHostEvent } from '../host/audit.js';

export interface InboundHandleResult {
  rejected: boolean;
  rejectReason?: string;
  session?: VoiceCallSession;
  disclosureText?: string;
  mediaStreamUrl: string;
  transferNumber?: string;
}

/**
 * Provider-neutral inbound call pipeline (H5):
 * verify already done → resolve binding → caller policy → mission → restricted session.
 */
export async function handleInboundCallEvents(input: {
  providerId: string;
  events: NormalizedTelephonyEvent[];
  fromE164?: string;
  toE164?: string;
  toProviderNumberId?: string;
}): Promise<InboundHandleResult> {
  const store = getVoiceCallStore();
  const telephony = getTelephonyService();
  const host = tryGetHostGateway();
  const config = telephony.getConfig();
  const providerId = input.providerId;

  telephony.assertCapability(providerId, 'inboundCalls');
  if (!config.inboundEnabled) {
    metricsRegistry.incrementCounter('telephony_calls_total', { direction: 'inbound', status: 'disabled' });
    return reject('inbound_disabled', providerId);
  }

  const event = input.events[0];
  const providerCallId = event?.providerCallId ?? 'unknown';

  // Idempotent: existing session for this provider call.
  const existing = await store.getSessionByProviderCall(providerId, providerCallId);
  if (existing) {
    for (const ev of input.events) {
      await store.appendEvent({
        callSessionId: existing.id,
        providerEventId: ev.providerEventId,
        eventType: ev.type,
        payload: redactPayload(ev.payload),
        occurredAt: ev.occurredAt,
      });
      await applyEventState(store, existing.id, ev.type);
    }
    return {
      rejected: false,
      session: (await store.getSession(existing.id)) ?? existing,
      disclosureText: buildDisclosure(config.aiDisclosure),
      mediaStreamUrl: buildMediaUrl(providerId),
    };
  }

  const fromE164 = input.fromE164 ?? extractPhone(event?.payload, ['From', 'from', 'CallerId', 'CallFrom']);
  const toE164 = input.toE164 ?? extractPhone(event?.payload, ['To', 'to', 'Called', 'CallTo']);
  const toProviderNumberId =
    input.toProviderNumberId ??
    extractPhone(event?.payload, ['To', 'Called', 'PhoneNumberSid', 'providerNumberId']);

  const binding =
    (await store.findBindingByProviderNumber(providerId, toProviderNumberId ?? '')) ??
    (await store.findBindingByE164(providerId, toE164 ?? ''));

  if (!binding || !binding.inboundEnabled) {
    // Soft-create binding from config numbers if present.
    const cfgNumbers = config.providers?.[providerId]?.numbers ?? [];
    const cfgMatch = cfgNumbers.find(
      (n) =>
        n.providerNumberId === toProviderNumberId ||
        n.e164 === toE164 ||
        n.id === toProviderNumberId,
    );
    if (cfgNumbers.length > 0 && !cfgMatch?.inboundEnabled) {
      metricsRegistry.incrementCounter('telephony_calls_total', { direction: 'inbound', status: 'unbound' });
      return reject('number_not_bound', providerId);
    }
    // No bindings configured yet — allow with default mission (first-run plug-n-play).
  }

  const policy = CallerPolicy.fromConfig(config, store);
  if (fromE164) {
    const decision = await policy.resolve(fromE164);
    if (decision.decision === 'block') {
      metricsRegistry.incrementCounter('telephony_calls_total', { direction: 'inbound', status: 'blocked' });
      recordHostEvent({
        category: 'telephony',
        code: 'INBOUND_BLOCKED',
        message: `Inbound caller blocked (${decision.reason})`,
        metadata: { providerId, reason: decision.reason },
      });
      return reject(decision.reason, providerId);
    }
  }

  let missionId = config.defaultMissionId ?? null;
  if (missionId) {
    const mission = await store.getMission(missionId);
    if (!mission || mission.status === 'cancelled' || mission.status === 'failed') {
      missionId = null;
    }
  }
  if (!missionId) {
    const draft = createDefaultInboundMission(
      providerId,
      binding?.id ?? cfgPhoneNumberId(config, providerId) ?? 'default',
    );
    draft.status = 'armed';
    const saved = await store.saveMission(draft);
    missionId = saved.id;
  }

  const mission = await store.getMission(missionId);
  const active = await store.countActiveSessions();
  const maxConcurrent = config.maxConcurrentCalls ?? 1;
  if (active >= maxConcurrent) {
    metricsRegistry.incrementCounter('telephony_calls_total', { direction: 'inbound', status: 'busy' });
    return reject('concurrency_limit', providerId);
  }

  const session = await store.saveSession({
    id: randomUUID(),
    missionId,
    providerId,
    providerCallId,
    direction: 'inbound',
    state: 'created',
    fromE164Redacted: fromE164 ? redactE164(fromE164) : null,
    toE164Redacted: toE164 ? redactE164(toE164) : null,
    phoneNumberId: binding?.id ?? mission?.phoneNumberId ?? null,
    costMinorUnits: 0,
    startedAt: new Date().toISOString(),
  });

  for (const ev of input.events) {
    await store.appendEvent({
      callSessionId: session.id,
      providerEventId: ev.providerEventId,
      eventType: ev.type,
      payload: redactPayload(ev.payload),
      occurredAt: ev.occurredAt,
    });
  }

  let state = session.state;
  try {
    state = CallSessionStateMachine.transition(state, 'ringing');
    state = CallSessionStateMachine.transition(state, 'connected');
    state = CallSessionStateMachine.transition(state, 'disclosing');
    await store.saveSession({
      ...session,
      state,
      connectedAt: new Date().toISOString(),
    });
  } catch (err) {
    getLogger().warn('INBOUND_STATE', 'State transition issue', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Schedule max-duration hangup watchdog
  const maxSeconds = mission?.maxDurationSeconds ?? config.maxDurationSeconds ?? 600;
  scheduleCallTimeout(session.id, maxSeconds);

  metricsRegistry.incrementCounter('telephony_calls_total', { direction: 'inbound', status: 'accepted' });
  recordHostEvent({
    category: 'telephony',
    code: 'INBOUND_ACCEPTED',
    message: 'Inbound call session created',
    metadata: { providerId, sessionId: session.id },
  });

  const disclosure = buildDisclosure(mission?.aiDisclosure ?? config.aiDisclosure);
  return {
    rejected: false,
    session: (await store.getSession(session.id)) ?? session,
    disclosureText: disclosure,
    mediaStreamUrl: buildMediaUrl(providerId),
    transferNumber: mission?.escalation?.transferNumber,
  };
}

export async function handleStatusOrRecordingEvents(input: {
  providerId: string;
  events: NormalizedTelephonyEvent[];
  kind: 'status' | 'recording';
}): Promise<void> {
  const store = getVoiceCallStore();
  for (const ev of input.events) {
    const session = await store.getSessionByProviderCall(input.providerId, ev.providerCallId);
    if (!session) continue;
    await store.appendEvent({
      callSessionId: session.id,
      providerEventId: ev.providerEventId,
      eventType: ev.type,
      payload: redactPayload(ev.payload),
      occurredAt: ev.occurredAt,
    });
    if (input.kind === 'recording' && (ev.payload['RecordingUrl'] || ev.payload['recordingUrl'])) {
      await store.saveSession({
        ...session,
        recordingRef: String(ev.payload['RecordingUrl'] ?? ev.payload['recordingUrl']),
      });
    }
    await applyEventState(store, session.id, ev.type);
    if (ev.type === 'completed' || ev.type === 'failed' || ev.type === 'cancelled') {
      metricsRegistry.incrementCounter('telephony_calls_total', {
        direction: session.direction,
        status: ev.type,
      });
    }
  }
}

export async function handleDtmf(input: {
  providerId: string;
  providerCallId: string;
  digits: string;
}): Promise<{ handled: boolean; action?: string }> {
  // DTMF is never authorization by itself — only mission-configured stop/transfer hints.
  const store = getVoiceCallStore();
  const session = await store.getSessionByProviderCall(input.providerId, input.providerCallId);
  if (!session?.missionId) return { handled: false };
  const mission = await store.getMission(session.missionId);
  await store.appendEvent({
    callSessionId: session.id,
    eventType: 'dtmf',
    payload: { digits: input.digits.length > 8 ? '[redacted-long]' : input.digits },
  });
  if (input.digits === '0' && mission?.escalation?.transferNumber) {
    return { handled: true, action: 'transfer' };
  }
  if (input.digits === '*' || input.digits.toLowerCase() === 'stop') {
    // Opt-out request — mark consent if we have a hash from redacted only (cannot reverse).
    return { handled: true, action: 'opt_out_request' };
  }
  return { handled: true, action: 'ignored' };
}

function reject(reason: string, providerId: string): InboundHandleResult {
  recordHostEvent({
    category: 'telephony',
    code: 'INBOUND_REJECTED',
    message: reason,
    metadata: { providerId, reason },
  });
  return {
    rejected: true,
    rejectReason: reason,
    mediaStreamUrl: buildMediaUrl(providerId),
  };
}

function buildMediaUrl(providerId: string): string {
  const host = tryGetHostGateway();
  const tunnelUrl = host?.getTunnelStatus().publicUrl;
  if (tunnelUrl) {
    return `${tunnelUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/api/telephony/${providerId}/media`;
  }
  const port = host?.getStatus().network.bindPort ?? 3333;
  return `ws://127.0.0.1:${port}/api/telephony/${providerId}/media`;
}

function buildDisclosure(policy?: string): string | undefined {
  if (policy === 'disabled_only_if_legal') return undefined;
  return 'You are speaking with an AI assistant. This call may be monitored according to your configured policy.';
}

function extractPhone(payload: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!payload) return undefined;
  for (const k of keys) {
    const v = payload[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function cfgPhoneNumberId(
  config: ReturnType<ReturnType<typeof getTelephonyService>['getConfig']>,
  providerId: string,
): string | undefined {
  return config.providers?.[providerId]?.numbers?.[0]?.id;
}

function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (/from|to|caller|called|phone|number/i.test(k) && typeof v === 'string') {
      out[k] = redactE164(v);
    } else if (/token|secret|password|authorization/i.test(k)) {
      out[k] = '[redacted]';
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function applyEventState(store: VoiceCallStore, sessionId: string, type: string): Promise<void> {
  const session = await store.getSession(sessionId);
  if (!session) return;
  const map: Record<string, Parameters<typeof CallSessionStateMachine.transition>[1]> = {
    ringing: 'ringing',
    connected: 'connected',
    media_ready: 'active',
    transferred: 'transferring',
    completed: 'completed',
    failed: 'failed',
    cancelled: 'cancelled',
  };
  const next = map[type];
  if (!next) return;
  try {
    const state = CallSessionStateMachine.transition(session.state, next);
    await store.saveSession({
      ...session,
      state,
      endedAt: ['completed', 'failed', 'cancelled'].includes(state) ? new Date().toISOString() : session.endedAt,
      outcome: ['completed', 'failed', 'cancelled'].includes(state) ? state : session.outcome,
    });
  } catch {
    /* illegal transition — ignore for out-of-order provider events */
  }
}

const timeouts = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleCallTimeout(sessionId: string, maxSeconds: number): void {
  const prev = timeouts.get(sessionId);
  if (prev) clearTimeout(prev);
  const handle = setTimeout(() => {
    void (async () => {
      const store = getVoiceCallStore();
      const session = await store.getSession(sessionId);
      if (!session) return;
      if (['completed', 'failed', 'cancelled'].includes(session.state)) return;
      try {
        const state = CallSessionStateMachine.transition(session.state, 'cancelled');
        await store.saveSession({
          ...session,
          state,
          endedAt: new Date().toISOString(),
          outcome: 'timeout',
          outcomeSummary: 'Max duration reached',
        });
        metricsRegistry.incrementCounter('telephony_calls_total', {
          direction: session.direction,
          status: 'timeout',
        });
      } catch {
        /* ignore */
      }
    })();
  }, Math.max(30, maxSeconds) * 1000);
  timeouts.set(sessionId, handle);
}

export function __clearInboundTimeouts(): void {
  for (const t of timeouts.values()) clearTimeout(t);
  timeouts.clear();
}
