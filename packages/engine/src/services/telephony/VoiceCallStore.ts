import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  TelephonyProviderId,
  VoiceCallDirection,
  VoiceCallMission,
  VoiceCallMissionStatus,
} from '@agentx/shared';
import { CallSessionStateMachine, type CallSessionState } from './CallSessionStateMachine.js';

/**
 * Domain records for the Host/VOIP call store — mirrors the V009 migration
 * (`voice_call_missions`, `voice_call_sessions`, `voice_call_events`,
 * `voice_call_consents`, `voice_call_provider_bindings`, `host_security_events`).
 */

export interface VoiceCallSession {
  id: string;
  missionId?: string | null;
  providerId: TelephonyProviderId;
  providerCallId?: string | null;
  direction: VoiceCallDirection;
  state: CallSessionState;
  /** Redacted numbers only — never persist raw E.164 here. */
  fromE164Redacted?: string | null;
  toE164Redacted?: string | null;
  phoneNumberId?: string | null;
  idempotencyKey?: string | null;
  costMinorUnits: number;
  startedAt?: string | null;
  connectedAt?: string | null;
  endedAt?: string | null;
  outcome?: string | null;
  outcomeSummary?: string | null;
  recordingRef?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Insert/update payload — store fills createdAt/updatedAt when omitted. */
export type VoiceCallSessionWrite = Omit<VoiceCallSession, 'createdAt' | 'updatedAt'> & {
  createdAt?: string;
  updatedAt?: string;
};

export interface VoiceCallEvent {
  id: string;
  callSessionId: string;
  providerEventId?: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
}

export interface VoiceCallConsent {
  id: string;
  e164Hash: string;
  e164Redacted: string;
  consentType: string;
  granted: boolean;
  source?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VoiceCallProviderBinding {
  id: string;
  providerId: TelephonyProviderId;
  providerNumberId?: string | null;
  e164?: string | null;
  e164Redacted?: string | null;
  label?: string | null;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Insert/update payload — store fills createdAt/updatedAt when omitted. */
export type VoiceCallProviderBindingWrite = Omit<VoiceCallProviderBinding, 'createdAt' | 'updatedAt'> & {
  createdAt?: string;
  updatedAt?: string;
};

export interface HostSecurityEvent {
  id: string;
  category: string;
  code: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Consent types that gate outbound dialing / inbound handling entirely. */
const OPT_OUT_CONSENT_TYPES = ['opt_out', 'do_not_call', 'stop'];

export interface ListMissionsFilter {
  status?: VoiceCallMissionStatus;
  direction?: VoiceCallDirection;
  providerId?: TelephonyProviderId;
}

export interface ListSessionsFilter {
  state?: CallSessionState;
  direction?: VoiceCallDirection;
  missionId?: string;
  providerId?: TelephonyProviderId;
}

export interface AppendEventInput {
  id?: string;
  callSessionId: string;
  providerEventId?: string | null;
  eventType: string;
  payload?: Record<string, unknown>;
  occurredAt?: string;
}

export interface AppendEventResult {
  event: VoiceCallEvent;
  /** True when an event with the same (callSessionId, providerEventId) already existed. */
  duplicate: boolean;
}

export interface SaveConsentInput {
  id?: string;
  e164Hash: string;
  e164Redacted: string;
  consentType: string;
  granted: boolean;
  source?: string | null;
  notes?: string | null;
}

export interface AppendSecurityEventInput {
  id?: string;
  category: string;
  code: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface VoiceCallStoreOptions {
  pool?: Pool;
}

/**
 * Voice call domain store. Uses an in-memory Map by default (works
 * out-of-the-box in tests and single-process dev); pass a pg `Pool` to
 * persist against the V009 schema instead.
 */
export class VoiceCallStore {
  private readonly pool: Pool | undefined;

  private readonly missions = new Map<string, VoiceCallMission>();
  private readonly sessions = new Map<string, VoiceCallSession>();
  private readonly eventsBySession = new Map<string, VoiceCallEvent[]>();
  private readonly consentsById = new Map<string, VoiceCallConsent>();
  private readonly consentsByKey = new Map<string, VoiceCallConsent>();
  private readonly bindings = new Map<string, VoiceCallProviderBinding>();
  private readonly securityEvents: HostSecurityEvent[] = [];

  constructor(options: VoiceCallStoreOptions = {}) {
    this.pool = options.pool;
  }

  // ---------------------------------------------------------------- missions

  async saveMission(mission: VoiceCallMission): Promise<VoiceCallMission> {
    const now = new Date().toISOString();
    const record: VoiceCallMission = { ...mission, createdAt: mission.createdAt ?? now, updatedAt: now };

    if (this.pool) {
      await this.pool.query(
        `INSERT INTO voice_call_missions (
           id, session_id, direction, provider_id, phone_number_id, recipient_e164, purpose, system_context,
           allowed_actions, forbidden_actions, allowed_tool_ids, require_confirmation_for, max_duration_seconds,
           max_cost_minor_units, recording, ai_disclosure, escalation, stop_conditions, status, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW())
         ON CONFLICT (id) DO UPDATE SET
           session_id = EXCLUDED.session_id, direction = EXCLUDED.direction, provider_id = EXCLUDED.provider_id,
           phone_number_id = EXCLUDED.phone_number_id, recipient_e164 = EXCLUDED.recipient_e164,
           purpose = EXCLUDED.purpose, system_context = EXCLUDED.system_context,
           allowed_actions = EXCLUDED.allowed_actions, forbidden_actions = EXCLUDED.forbidden_actions,
           allowed_tool_ids = EXCLUDED.allowed_tool_ids, require_confirmation_for = EXCLUDED.require_confirmation_for,
           max_duration_seconds = EXCLUDED.max_duration_seconds, max_cost_minor_units = EXCLUDED.max_cost_minor_units,
           recording = EXCLUDED.recording, ai_disclosure = EXCLUDED.ai_disclosure, escalation = EXCLUDED.escalation,
           stop_conditions = EXCLUDED.stop_conditions, status = EXCLUDED.status, updated_at = NOW()`,
        [
          record.id,
          record.sessionId ?? null,
          record.direction,
          record.providerId,
          record.phoneNumberId,
          record.recipientE164 ?? null,
          record.purpose,
          record.systemContext ?? null,
          JSON.stringify(record.allowedActions ?? []),
          JSON.stringify(record.forbiddenActions ?? []),
          JSON.stringify(record.allowedToolIds ?? []),
          JSON.stringify(record.requireConfirmationFor ?? []),
          record.maxDurationSeconds,
          record.maxCostMinorUnits ?? null,
          record.recording,
          record.aiDisclosure,
          JSON.stringify(record.escalation ?? {}),
          JSON.stringify(record.stopConditions ?? []),
          record.status,
          record.createdAt,
        ],
      );
      return (await this.getMission(record.id)) ?? record;
    }

    this.missions.set(record.id, record);
    return record;
  }

  async getMission(id: string): Promise<VoiceCallMission | undefined> {
    if (this.pool) {
      const res = await this.pool.query(`SELECT * FROM voice_call_missions WHERE id = $1`, [id]);
      return res.rows[0] ? rowToMission(res.rows[0]) : undefined;
    }
    return this.missions.get(id);
  }

  async listMissions(filter: ListMissionsFilter = {}): Promise<VoiceCallMission[]> {
    if (this.pool) {
      const { clause, params } = buildWhereClause({
        status: filter.status,
        direction: filter.direction,
        provider_id: filter.providerId,
      });
      const res = await this.pool.query(
        `SELECT * FROM voice_call_missions ${clause} ORDER BY updated_at DESC`,
        params,
      );
      return res.rows.map(rowToMission);
    }
    return Array.from(this.missions.values())
      .filter(
        (m) =>
          (!filter.status || m.status === filter.status) &&
          (!filter.direction || m.direction === filter.direction) &&
          (!filter.providerId || m.providerId === filter.providerId),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  // ----------------------------------------------------------------- sessions

  async saveSession(session: VoiceCallSessionWrite): Promise<VoiceCallSession> {
    const now = new Date().toISOString();
    const record: VoiceCallSession = { ...session, createdAt: session.createdAt ?? now, updatedAt: now };

    if (this.pool) {
      await this.pool.query(
        `INSERT INTO voice_call_sessions (
           id, mission_id, provider_id, provider_call_id, direction, state, from_e164_redacted, to_e164_redacted,
           phone_number_id, idempotency_key, cost_minor_units, started_at, connected_at, ended_at, outcome,
           outcome_summary, recording_ref, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
         ON CONFLICT (id) DO UPDATE SET
           mission_id = EXCLUDED.mission_id, provider_id = EXCLUDED.provider_id,
           provider_call_id = EXCLUDED.provider_call_id, direction = EXCLUDED.direction, state = EXCLUDED.state,
           from_e164_redacted = EXCLUDED.from_e164_redacted, to_e164_redacted = EXCLUDED.to_e164_redacted,
           phone_number_id = EXCLUDED.phone_number_id, idempotency_key = EXCLUDED.idempotency_key,
           cost_minor_units = EXCLUDED.cost_minor_units, started_at = EXCLUDED.started_at,
           connected_at = EXCLUDED.connected_at, ended_at = EXCLUDED.ended_at, outcome = EXCLUDED.outcome,
           outcome_summary = EXCLUDED.outcome_summary, recording_ref = EXCLUDED.recording_ref, updated_at = NOW()`,
        [
          record.id,
          record.missionId ?? null,
          record.providerId,
          record.providerCallId ?? null,
          record.direction,
          record.state,
          record.fromE164Redacted ?? null,
          record.toE164Redacted ?? null,
          record.phoneNumberId ?? null,
          record.idempotencyKey ?? null,
          record.costMinorUnits,
          record.startedAt ?? null,
          record.connectedAt ?? null,
          record.endedAt ?? null,
          record.outcome ?? null,
          record.outcomeSummary ?? null,
          record.recordingRef ?? null,
          record.createdAt,
        ],
      );
      return (await this.getSession(record.id)) ?? record;
    }

    this.sessions.set(record.id, record);
    return record;
  }

  async getSession(id: string): Promise<VoiceCallSession | undefined> {
    if (this.pool) {
      const res = await this.pool.query(`SELECT * FROM voice_call_sessions WHERE id = $1`, [id]);
      return res.rows[0] ? rowToSession(res.rows[0]) : undefined;
    }
    return this.sessions.get(id);
  }

  async getSessionByProviderCall(
    providerId: TelephonyProviderId,
    providerCallId: string,
  ): Promise<VoiceCallSession | undefined> {
    if (this.pool) {
      const res = await this.pool.query(
        `SELECT * FROM voice_call_sessions WHERE provider_id = $1 AND provider_call_id = $2 LIMIT 1`,
        [providerId, providerCallId],
      );
      return res.rows[0] ? rowToSession(res.rows[0]) : undefined;
    }
    for (const session of this.sessions.values()) {
      if (session.providerId === providerId && session.providerCallId === providerCallId) return session;
    }
    return undefined;
  }

  async listSessions(filter: ListSessionsFilter = {}): Promise<VoiceCallSession[]> {
    if (this.pool) {
      const { clause, params } = buildWhereClause({
        state: filter.state,
        direction: filter.direction,
        mission_id: filter.missionId,
        provider_id: filter.providerId,
      });
      const res = await this.pool.query(
        `SELECT * FROM voice_call_sessions ${clause} ORDER BY updated_at DESC`,
        params,
      );
      return res.rows.map(rowToSession);
    }
    return Array.from(this.sessions.values())
      .filter(
        (s) =>
          (!filter.state || s.state === filter.state) &&
          (!filter.direction || s.direction === filter.direction) &&
          (!filter.missionId || s.missionId === filter.missionId) &&
          (!filter.providerId || s.providerId === filter.providerId),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  // ------------------------------------------------------------------ events

  /** Idempotent on (callSessionId, providerEventId) when providerEventId is present. */
  async appendEvent(input: AppendEventInput): Promise<AppendEventResult> {
    const id = input.id ?? randomUUID();
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const payload = input.payload ?? {};

    if (this.pool) {
      if (input.providerEventId) {
        const inserted = await this.pool.query(
          `INSERT INTO voice_call_events (id, call_session_id, provider_event_id, event_type, payload, occurred_at)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (call_session_id, provider_event_id) DO NOTHING
           RETURNING *`,
          [id, input.callSessionId, input.providerEventId, input.eventType, JSON.stringify(payload), occurredAt],
        );
        if (inserted.rows.length) {
          return { event: rowToEvent(inserted.rows[0]), duplicate: false };
        }
        const existing = await this.pool.query(
          `SELECT * FROM voice_call_events WHERE call_session_id = $1 AND provider_event_id = $2`,
          [input.callSessionId, input.providerEventId],
        );
        return { event: rowToEvent(existing.rows[0]), duplicate: true };
      }
      const res = await this.pool.query(
        `INSERT INTO voice_call_events (id, call_session_id, provider_event_id, event_type, payload, occurred_at)
         VALUES ($1,$2,NULL,$3,$4,$5) RETURNING *`,
        [id, input.callSessionId, input.eventType, JSON.stringify(payload), occurredAt],
      );
      return { event: rowToEvent(res.rows[0]), duplicate: false };
    }

    const list = this.eventsBySession.get(input.callSessionId) ?? [];
    if (input.providerEventId) {
      const duplicate = list.find((e) => e.providerEventId === input.providerEventId);
      if (duplicate) return { event: duplicate, duplicate: true };
    }
    const event: VoiceCallEvent = {
      id,
      callSessionId: input.callSessionId,
      providerEventId: input.providerEventId ?? null,
      eventType: input.eventType,
      payload,
      occurredAt,
      createdAt: new Date().toISOString(),
    };
    list.push(event);
    this.eventsBySession.set(input.callSessionId, list);
    return { event, duplicate: false };
  }

  async listEvents(callSessionId: string): Promise<VoiceCallEvent[]> {
    if (this.pool) {
      const res = await this.pool.query(
        `SELECT * FROM voice_call_events WHERE call_session_id = $1 ORDER BY occurred_at ASC`,
        [callSessionId],
      );
      return res.rows.map(rowToEvent);
    }
    return [...(this.eventsBySession.get(callSessionId) ?? [])];
  }

  // ---------------------------------------------------------------- consents

  async saveConsent(input: SaveConsentInput): Promise<VoiceCallConsent> {
    const now = new Date().toISOString();

    if (this.pool) {
      const existing = input.id
        ? undefined
        : await this.pool.query(
            `SELECT id FROM voice_call_consents WHERE e164_hash = $1 AND consent_type = $2 LIMIT 1`,
            [input.e164Hash, input.consentType],
          );
      const id = input.id ?? (existing?.rows[0]?.id as string | undefined) ?? randomUUID();
      const res = await this.pool.query(
        `INSERT INTO voice_call_consents (id, e164_hash, e164_redacted, consent_type, granted, source, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET
           e164_hash = EXCLUDED.e164_hash, e164_redacted = EXCLUDED.e164_redacted,
           consent_type = EXCLUDED.consent_type, granted = EXCLUDED.granted, source = EXCLUDED.source,
           notes = EXCLUDED.notes, updated_at = NOW()
         RETURNING *`,
        [id, input.e164Hash, input.e164Redacted, input.consentType, input.granted, input.source ?? null, input.notes ?? null],
      );
      return rowToConsent(res.rows[0]);
    }

    const key = `${input.e164Hash}:${input.consentType}`;
    const existing = this.consentsByKey.get(key);
    const id = input.id ?? existing?.id ?? randomUUID();
    const record: VoiceCallConsent = {
      id,
      e164Hash: input.e164Hash,
      e164Redacted: input.e164Redacted,
      consentType: input.consentType,
      granted: input.granted,
      source: input.source ?? null,
      notes: input.notes ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.consentsByKey.set(key, record);
    this.consentsById.set(id, record);
    return record;
  }

  async isOptedOut(e164Hash: string): Promise<boolean> {
    if (this.pool) {
      const res = await this.pool.query(
        `SELECT 1 FROM voice_call_consents WHERE e164_hash = $1 AND consent_type = ANY($2::text[]) AND granted = TRUE LIMIT 1`,
        [e164Hash, OPT_OUT_CONSENT_TYPES],
      );
      return (res.rowCount ?? 0) > 0;
    }
    for (const consent of this.consentsById.values()) {
      if (consent.e164Hash === e164Hash && consent.granted && OPT_OUT_CONSENT_TYPES.includes(consent.consentType)) {
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- bindings

  async saveBinding(binding: VoiceCallProviderBindingWrite): Promise<VoiceCallProviderBinding> {
    const now = new Date().toISOString();
    const record: VoiceCallProviderBinding = { ...binding, createdAt: binding.createdAt ?? now, updatedAt: now };

    if (this.pool) {
      await this.pool.query(
        `INSERT INTO voice_call_provider_bindings (
           id, provider_id, provider_number_id, e164, e164_redacted, label, inbound_enabled, outbound_enabled,
           created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
         ON CONFLICT (id) DO UPDATE SET
           provider_id = EXCLUDED.provider_id, provider_number_id = EXCLUDED.provider_number_id,
           e164 = EXCLUDED.e164, e164_redacted = EXCLUDED.e164_redacted, label = EXCLUDED.label,
           inbound_enabled = EXCLUDED.inbound_enabled, outbound_enabled = EXCLUDED.outbound_enabled,
           updated_at = NOW()`,
        [
          record.id,
          record.providerId,
          record.providerNumberId ?? null,
          record.e164 ?? null,
          record.e164Redacted ?? null,
          record.label ?? null,
          record.inboundEnabled,
          record.outboundEnabled,
          record.createdAt,
        ],
      );
      const res = await this.pool.query(`SELECT * FROM voice_call_provider_bindings WHERE id = $1`, [record.id]);
      return res.rows[0] ? rowToBinding(res.rows[0]) : record;
    }

    this.bindings.set(record.id, record);
    return record;
  }

  async findBindingByProviderNumber(
    providerId: TelephonyProviderId,
    providerNumberId: string,
  ): Promise<VoiceCallProviderBinding | undefined> {
    if (!providerNumberId) return undefined;
    if (this.pool) {
      const res = await this.pool.query(
        `SELECT * FROM voice_call_provider_bindings WHERE provider_id = $1 AND provider_number_id = $2 LIMIT 1`,
        [providerId, providerNumberId],
      );
      return res.rows[0] ? rowToBinding(res.rows[0]) : undefined;
    }
    for (const binding of this.bindings.values()) {
      if (binding.providerId === providerId && binding.providerNumberId === providerNumberId) return binding;
    }
    return undefined;
  }

  async findBindingByE164(
    providerId: TelephonyProviderId,
    e164: string,
  ): Promise<VoiceCallProviderBinding | undefined> {
    if (!e164) return undefined;
    if (this.pool) {
      const res = await this.pool.query(
        `SELECT * FROM voice_call_provider_bindings WHERE provider_id = $1 AND e164 = $2 LIMIT 1`,
        [providerId, e164],
      );
      return res.rows[0] ? rowToBinding(res.rows[0]) : undefined;
    }
    for (const binding of this.bindings.values()) {
      if (binding.providerId === providerId && binding.e164 === e164) return binding;
    }
    return undefined;
  }

  async listBindings(providerId?: TelephonyProviderId): Promise<VoiceCallProviderBinding[]> {
    if (this.pool) {
      const res = providerId
        ? await this.pool.query(
            `SELECT * FROM voice_call_provider_bindings WHERE provider_id = $1 ORDER BY created_at DESC`,
            [providerId],
          )
        : await this.pool.query(`SELECT * FROM voice_call_provider_bindings ORDER BY created_at DESC`);
      return res.rows.map(rowToBinding);
    }
    return Array.from(this.bindings.values()).filter((b) => !providerId || b.providerId === providerId);
  }

  // --------------------------------------------------------- security events

  async appendSecurityEvent(input: AppendSecurityEventInput): Promise<HostSecurityEvent> {
    const id = input.id ?? randomUUID();
    const metadata = input.metadata ?? {};

    if (this.pool) {
      const res = await this.pool.query(
        `INSERT INTO host_security_events (id, category, code, message, metadata) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [id, input.category, input.code, input.message, JSON.stringify(metadata)],
      );
      return rowToSecurityEvent(res.rows[0]);
    }

    const event: HostSecurityEvent = {
      id,
      category: input.category,
      code: input.code,
      message: input.message,
      metadata,
      createdAt: new Date().toISOString(),
    };
    this.securityEvents.unshift(event);
    return event;
  }

  async listSecurityEvents(filter: { category?: string; limit?: number } = {}): Promise<HostSecurityEvent[]> {
    const limit = filter.limit ?? 100;
    if (this.pool) {
      const res = filter.category
        ? await this.pool.query(
            `SELECT * FROM host_security_events WHERE category = $1 ORDER BY created_at DESC LIMIT $2`,
            [filter.category, limit],
          )
        : await this.pool.query(`SELECT * FROM host_security_events ORDER BY created_at DESC LIMIT $1`, [limit]);
      return res.rows.map(rowToSecurityEvent);
    }
    return this.securityEvents.filter((e) => !filter.category || e.category === filter.category).slice(0, limit);
  }

  // ---------------------------------------------------- cost / concurrency

  async countActiveSessions(): Promise<number> {
    if (this.pool) {
      const res = await this.pool.query(
        `SELECT COUNT(*)::int AS count FROM voice_call_sessions WHERE state NOT IN ('completed','failed','cancelled')`,
      );
      return Number(res.rows[0]?.count ?? 0);
    }
    let count = 0;
    for (const session of this.sessions.values()) {
      if (!CallSessionStateMachine.isTerminal(session.state)) count += 1;
    }
    return count;
  }

  async sumCostToday(): Promise<number> {
    if (this.pool) {
      const res = await this.pool.query(
        `SELECT COALESCE(SUM(cost_minor_units), 0)::bigint AS total FROM voice_call_sessions
         WHERE created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')`,
      );
      return Number(res.rows[0]?.total ?? 0);
    }
    const startOfDayUtc = new Date();
    startOfDayUtc.setUTCHours(0, 0, 0, 0);
    let total = 0;
    for (const session of this.sessions.values()) {
      if (new Date(session.createdAt).getTime() >= startOfDayUtc.getTime()) {
        total += session.costMinorUnits;
      }
    }
    return total;
  }

  /** Test-only helper — clears all in-memory state. No-op when backed by a pool. */
  reset(): void {
    this.missions.clear();
    this.sessions.clear();
    this.eventsBySession.clear();
    this.consentsById.clear();
    this.consentsByKey.clear();
    this.bindings.clear();
    this.securityEvents.length = 0;
  }
}

let voiceCallStoreSingleton: VoiceCallStore | null = null;

export function getVoiceCallStore(): VoiceCallStore {
  if (!voiceCallStoreSingleton) voiceCallStoreSingleton = new VoiceCallStore();
  return voiceCallStoreSingleton;
}

export function setVoiceCallStore(store: VoiceCallStore | null): void {
  voiceCallStoreSingleton = store;
}

// --------------------------------------------------------------- row mapping

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return value == null ? '' : String(value);
}

function toIsoOrNull(value: unknown): string | null {
  if (value == null) return null;
  return toIso(value);
}

function buildWhereClause(fields: Record<string, string | undefined>): { clause: string; params: unknown[] } {
  const params: unknown[] = [];
  const clauses: string[] = [];
  for (const [column, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    params.push(value);
    clauses.push(`${column} = $${params.length}`);
  }
  return { clause: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function rowToMission(row: Record<string, unknown>): VoiceCallMission {
  return {
    id: String(row.id),
    sessionId: row.session_id ? String(row.session_id) : undefined,
    direction: row.direction as VoiceCallDirection,
    providerId: String(row.provider_id) as TelephonyProviderId,
    phoneNumberId: String(row.phone_number_id),
    recipientE164: row.recipient_e164 ? String(row.recipient_e164) : undefined,
    purpose: String(row.purpose),
    systemContext: row.system_context ? String(row.system_context) : undefined,
    allowedActions: (row.allowed_actions as string[]) ?? [],
    forbiddenActions: (row.forbidden_actions as string[]) ?? [],
    allowedToolIds: (row.allowed_tool_ids as string[]) ?? [],
    requireConfirmationFor: (row.require_confirmation_for as string[]) ?? [],
    maxDurationSeconds: Number(row.max_duration_seconds),
    maxCostMinorUnits: row.max_cost_minor_units != null ? Number(row.max_cost_minor_units) : undefined,
    recording: row.recording as VoiceCallMission['recording'],
    aiDisclosure: row.ai_disclosure as VoiceCallMission['aiDisclosure'],
    escalation: (row.escalation as VoiceCallMission['escalation']) ?? {},
    stopConditions: (row.stop_conditions as string[]) ?? [],
    status: row.status as VoiceCallMissionStatus,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function rowToSession(row: Record<string, unknown>): VoiceCallSession {
  return {
    id: String(row.id),
    missionId: row.mission_id ? String(row.mission_id) : null,
    providerId: String(row.provider_id) as TelephonyProviderId,
    providerCallId: row.provider_call_id ? String(row.provider_call_id) : null,
    direction: row.direction as VoiceCallDirection,
    state: row.state as CallSessionState,
    fromE164Redacted: row.from_e164_redacted ? String(row.from_e164_redacted) : null,
    toE164Redacted: row.to_e164_redacted ? String(row.to_e164_redacted) : null,
    phoneNumberId: row.phone_number_id ? String(row.phone_number_id) : null,
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
    costMinorUnits: Number(row.cost_minor_units ?? 0),
    startedAt: toIsoOrNull(row.started_at),
    connectedAt: toIsoOrNull(row.connected_at),
    endedAt: toIsoOrNull(row.ended_at),
    outcome: row.outcome ? String(row.outcome) : null,
    outcomeSummary: row.outcome_summary ? String(row.outcome_summary) : null,
    recordingRef: row.recording_ref ? String(row.recording_ref) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function rowToEvent(row: Record<string, unknown>): VoiceCallEvent {
  return {
    id: String(row.id),
    callSessionId: String(row.call_session_id),
    providerEventId: row.provider_event_id ? String(row.provider_event_id) : null,
    eventType: String(row.event_type),
    payload: (row.payload as Record<string, unknown>) ?? {},
    occurredAt: toIso(row.occurred_at),
    createdAt: toIso(row.created_at),
  };
}

function rowToConsent(row: Record<string, unknown>): VoiceCallConsent {
  return {
    id: String(row.id),
    e164Hash: String(row.e164_hash),
    e164Redacted: String(row.e164_redacted),
    consentType: String(row.consent_type),
    granted: Boolean(row.granted),
    source: row.source ? String(row.source) : null,
    notes: row.notes ? String(row.notes) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function rowToBinding(row: Record<string, unknown>): VoiceCallProviderBinding {
  return {
    id: String(row.id),
    providerId: String(row.provider_id) as TelephonyProviderId,
    providerNumberId: row.provider_number_id ? String(row.provider_number_id) : null,
    e164: row.e164 ? String(row.e164) : null,
    e164Redacted: row.e164_redacted ? String(row.e164_redacted) : null,
    label: row.label ? String(row.label) : null,
    inboundEnabled: Boolean(row.inbound_enabled),
    outboundEnabled: Boolean(row.outbound_enabled),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function rowToSecurityEvent(row: Record<string, unknown>): HostSecurityEvent {
  return {
    id: String(row.id),
    category: String(row.category),
    code: String(row.code),
    message: String(row.message),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: toIso(row.created_at),
  };
}
