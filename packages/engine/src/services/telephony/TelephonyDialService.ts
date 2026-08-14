import { randomUUID } from 'node:crypto';
import { getLogger } from '@agentx/shared';
import type { ProviderCall } from './ITelephonyProvider.js';
import { CallSessionStateMachine, type CallSessionState } from './CallSessionStateMachine.js';
import { hashE164, redactE164 } from './phone-redaction.js';
import { getTelephonyService, type TelephonyService } from './TelephonyService.js';
import {
  getVoiceCallStore,
  type VoiceCallSession,
  type VoiceCallStore,
} from './VoiceCallStore.js';

export type TelephonyDialErrorCode =
  | 'mission_not_found'
  | 'mission_not_armed'
  | 'invalid_direction'
  | 'missing_recipient'
  | 'recipient_opted_out'
  | 'approval_required'
  | 'concurrency_limit_reached'
  | 'daily_spend_cap_reached'
  | 'session_not_found';

export class TelephonyDialError extends Error {
  constructor(
    public readonly code: TelephonyDialErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TelephonyDialError';
  }
}

export interface DialInput {
  missionId: string;
  /** Overrides mission.recipientE164 when provided. */
  toE164?: string;
  webhookBaseUrl: string;
  statusCallbackUrl?: string;
  timeoutSeconds?: number;
  /** Must be true for first-time recipients when the mission requires confirmation. */
  approved?: boolean;
  requestedBy?: string;
}

export interface DialResult {
  session: VoiceCallSession;
  providerCall: ProviderCall;
}

export interface TelephonyDialServiceOptions {
  telephonyService?: TelephonyService;
  store?: VoiceCallStore;
  /** Hard cap on total spend per UTC day, in provider minor currency units. */
  dailySpendCapMinorUnits?: number;
  maxConcurrentCalls?: number;
}

/**
 * Provider-neutral outbound dial service — owns mission checks, first-time
 * recipient approval, spending/concurrency limits, and session bookkeeping.
 * Adapters never dial on their own; everything routes through here.
 */
export class TelephonyDialService {
  private readonly telephony: TelephonyService;
  private readonly store: VoiceCallStore;
  private readonly dailySpendCapMinorUnits: number | undefined;
  private readonly maxConcurrentCalls: number | undefined;

  constructor(options: TelephonyDialServiceOptions = {}) {
    this.telephony = options.telephonyService ?? getTelephonyService();
    this.store = options.store ?? getVoiceCallStore();
    this.dailySpendCapMinorUnits = options.dailySpendCapMinorUnits;
    this.maxConcurrentCalls = options.maxConcurrentCalls;
  }

  async dial(input: DialInput): Promise<DialResult> {
    const mission = await this.store.getMission(input.missionId);
    if (!mission) {
      throw new TelephonyDialError('mission_not_found', `Mission not found: ${input.missionId}`);
    }
    if (mission.status !== 'armed') {
      throw new TelephonyDialError(
        'mission_not_armed',
        `Mission must be armed before dialing (current status: ${mission.status})`,
      );
    }
    if (mission.direction !== 'outbound') {
      throw new TelephonyDialError('invalid_direction', 'Mission is not configured for outbound calls');
    }

    const providerId = mission.providerId;
    this.telephony.assertCapability(providerId, 'outboundCalls');

    const toE164 = input.toE164 ?? mission.recipientE164;
    if (!toE164) {
      throw new TelephonyDialError('missing_recipient', 'No recipient E.164 number provided');
    }

    const recipientHash = hashE164(toE164);
    if (await this.store.isOptedOut(recipientHash)) {
      throw new TelephonyDialError('recipient_opted_out', 'Recipient has opted out of calls');
    }

    if (mission.requireConfirmationFor.includes('first_recipient') && !input.approved) {
      const priorCompleted = await this.hasPriorCompletedSession(recipientHash);
      if (!priorCompleted) {
        throw new TelephonyDialError(
          'approval_required',
          'First-time recipient requires explicit approval before dialing (set approved: true)',
        );
      }
    }

    await this.assertWithinConcurrencyLimit();
    await this.assertWithinSpendingLimits(mission.maxCostMinorUnits);

    const fromBinding = await this.resolveFromBinding(providerId, mission.phoneNumberId);
    const now = new Date().toISOString();
    const sessionId = randomUUID();

    let session = await this.store.saveSession({
      id: sessionId,
      missionId: mission.id,
      providerId,
      providerCallId: null,
      direction: 'outbound',
      state: 'created',
      fromE164Redacted: fromBinding ? redactE164(fromBinding.e164) : null,
      toE164Redacted: redactE164(toE164),
      phoneNumberId: mission.phoneNumberId,
      idempotencyKey: `${recipientHash}:${mission.id}:${sessionId}`,
      costMinorUnits: 0,
      createdAt: now,
      updatedAt: now,
    });

    const credentials = this.telephony.getCredentials(providerId);

    let providerCall: ProviderCall;
    try {
      providerCall = await this.telephony.createOutboundCall({
        fromBindingId: mission.phoneNumberId,
        toE164,
        missionId: mission.id,
        webhookBaseUrl: input.webhookBaseUrl,
        statusCallbackUrl: input.statusCallbackUrl,
        timeoutSeconds: input.timeoutSeconds,
        credentials,
      });
    } catch (err) {
      await this.store.saveSession({
        ...session,
        state: 'failed',
        outcome: 'dial_failed',
        outcomeSummary: err instanceof Error ? err.message : 'Dial failed',
        endedAt: new Date().toISOString(),
      });
      getLogger().error('TELEPHONY_DIAL_FAILED', err, { providerId, missionId: mission.id });
      throw err;
    }

    session = await this.store.saveSession({
      ...session,
      providerCallId: providerCall.providerCallId,
      state: mapProviderCallStatusToSessionState(providerCall.status),
      startedAt: now,
    });

    return { session, providerCall };
  }

  async cancel(sessionId: string, reason = 'cancelled_by_operator'): Promise<VoiceCallSession> {
    const session = await this.store.getSession(sessionId);
    if (!session) {
      throw new TelephonyDialError('session_not_found', `Call session not found: ${sessionId}`);
    }
    if (CallSessionStateMachine.isTerminal(session.state)) {
      return session;
    }
    if (session.providerCallId) {
      const adapter = this.telephony.getRegistry().get(session.providerId);
      if (adapter) {
        await adapter.endCall(session.providerCallId, reason).catch((err) => {
          getLogger().warn('TELEPHONY_END_CALL_FAILED', String(err), { sessionId, providerId: session.providerId });
        });
      }
    }
    return this.store.saveSession({
      ...session,
      state: 'cancelled',
      outcome: 'cancelled',
      outcomeSummary: reason,
      endedAt: new Date().toISOString(),
    });
  }

  /** Global emergency stop — ends every non-terminal call session (inbound + outbound). */
  async emergencyEndAll(reason = 'emergency_stop'): Promise<VoiceCallSession[]> {
    const sessions = await this.store.listSessions({});
    const active = sessions.filter((s) => !CallSessionStateMachine.isTerminal(s.state));
    const results: VoiceCallSession[] = [];
    for (const session of active) {
      results.push(await this.cancel(session.id, reason));
    }
    return results;
  }

  private async hasPriorCompletedSession(recipientHash: string): Promise<boolean> {
    const sessions = await this.store.listSessions({ direction: 'outbound' });
    return sessions.some(
      (s) =>
        s.state === 'completed' &&
        typeof s.idempotencyKey === 'string' &&
        s.idempotencyKey.startsWith(`${recipientHash}:`),
    );
  }

  private async assertWithinConcurrencyLimit(): Promise<void> {
    if (this.maxConcurrentCalls == null) return;
    const active = await this.store.countActiveSessions();
    if (active >= this.maxConcurrentCalls) {
      throw new TelephonyDialError(
        'concurrency_limit_reached',
        `Max concurrent calls reached (${active}/${this.maxConcurrentCalls})`,
      );
    }
  }

  private async assertWithinSpendingLimits(missionMaxCostMinorUnits: number | undefined): Promise<void> {
    if (this.dailySpendCapMinorUnits == null) return;
    const spentToday = await this.store.sumCostToday();
    const projected = spentToday + (missionMaxCostMinorUnits ?? 0);
    if (projected > this.dailySpendCapMinorUnits) {
      throw new TelephonyDialError(
        'daily_spend_cap_reached',
        `Daily spending cap would be exceeded (${projected}/${this.dailySpendCapMinorUnits} minor units)`,
      );
    }
  }

  private async resolveFromBinding(providerId: string, phoneNumberId: string) {
    const bindings = await this.store.listBindings(providerId);
    return bindings.find((b) => b.id === phoneNumberId);
  }
}

function mapProviderCallStatusToSessionState(status: ProviderCall['status']): CallSessionState {
  switch (status) {
    case 'ringing':
      return 'ringing';
    case 'in_progress':
      return 'connected';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'queued':
    default:
      return 'created';
  }
}

let dialServiceSingleton: TelephonyDialService | null = null;

export function getTelephonyDialService(): TelephonyDialService {
  if (!dialServiceSingleton) {
    dialServiceSingleton = new TelephonyDialService();
  }
  return dialServiceSingleton;
}

export function setTelephonyDialService(service: TelephonyDialService | null): void {
  dialServiceSingleton = service;
}
