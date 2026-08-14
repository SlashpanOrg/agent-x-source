import { randomUUID } from 'node:crypto';
import type { TelephonyProviderId, VoiceCallMission } from '@agentx/shared';

/** No call may run shorter than 30s (avoids meaningless connects) or longer than 2h. */
export const MIN_MISSION_DURATION_SECONDS = 30;
export const MAX_MISSION_DURATION_SECONDS = 7200;

const VALID_RECORDING_POLICIES = ['off', 'on_with_disclosure', 'provider_default'];
const VALID_DISCLOSURE_POLICIES = ['required', 'automatic', 'disabled_only_if_legal'];
const VALID_DIRECTIONS = ['inbound', 'outbound'];
const VALID_STATUSES = ['draft', 'armed', 'running', 'completed', 'failed', 'cancelled'];

export interface MissionValidationIssue {
  field: string;
  message: string;
}

export interface MissionValidationResult {
  ok: boolean;
  issues: MissionValidationIssue[];
}

/**
 * Validate a (possibly partial) VoiceCallMission against Host/VOIP safety rules.
 * No call should begin without a mission that passes this check.
 */
export function validateVoiceCallMission(mission: Partial<VoiceCallMission>): MissionValidationResult {
  const issues: MissionValidationIssue[] = [];
  const push = (field: string, message: string): void => {
    issues.push({ field, message });
  };

  if (!mission.purpose || !mission.purpose.trim()) {
    push('purpose', 'Mission purpose is required.');
  }
  if (!mission.providerId || !String(mission.providerId).trim()) {
    push('providerId', 'Telephony provider is required.');
  }
  if (!mission.phoneNumberId || !mission.phoneNumberId.trim()) {
    push('phoneNumberId', 'A bound phone number is required.');
  }
  if (!mission.direction || !VALID_DIRECTIONS.includes(mission.direction)) {
    push('direction', 'Mission direction must be "inbound" or "outbound".');
  }
  if (mission.direction === 'outbound' && !mission.recipientE164?.trim()) {
    push('recipientE164', 'Outbound missions require a recipient E.164 number.');
  }

  const duration = mission.maxDurationSeconds;
  if (duration == null || !Number.isFinite(duration)) {
    push('maxDurationSeconds', 'Max duration is required.');
  } else if (duration < MIN_MISSION_DURATION_SECONDS) {
    push('maxDurationSeconds', `Max duration must be at least ${MIN_MISSION_DURATION_SECONDS} seconds.`);
  } else if (duration > MAX_MISSION_DURATION_SECONDS) {
    push('maxDurationSeconds', `Max duration must not exceed ${MAX_MISSION_DURATION_SECONDS} seconds.`);
  }

  if (mission.maxCostMinorUnits != null && (!Number.isFinite(mission.maxCostMinorUnits) || mission.maxCostMinorUnits < 0)) {
    push('maxCostMinorUnits', 'Max cost must be a non-negative number.');
  }

  for (const [field, value] of [
    ['allowedActions', mission.allowedActions],
    ['forbiddenActions', mission.forbiddenActions],
    ['allowedToolIds', mission.allowedToolIds],
    ['requireConfirmationFor', mission.requireConfirmationFor],
    ['stopConditions', mission.stopConditions],
  ] as const) {
    if (value !== undefined && !Array.isArray(value)) {
      push(field, `${field} must be a list of strings.`);
    }
  }

  if (mission.recording != null && !VALID_RECORDING_POLICIES.includes(mission.recording)) {
    push('recording', `Recording policy must be one of: ${VALID_RECORDING_POLICIES.join(', ')}.`);
  }
  if (mission.aiDisclosure != null && !VALID_DISCLOSURE_POLICIES.includes(mission.aiDisclosure)) {
    push('aiDisclosure', `AI disclosure policy must be one of: ${VALID_DISCLOSURE_POLICIES.join(', ')}.`);
  }
  if (mission.status != null && !VALID_STATUSES.includes(mission.status)) {
    push('status', `Status must be one of: ${VALID_STATUSES.join(', ')}.`);
  }

  return { ok: issues.length === 0, issues };
}

export function assertValidVoiceCallMission(mission: Partial<VoiceCallMission>): void {
  const result = validateVoiceCallMission(mission);
  if (!result.ok) {
    const detail = result.issues.map((issue) => `${issue.field}: ${issue.message}`).join('; ');
    throw new Error(`Invalid voice call mission — ${detail}`);
  }
}

/**
 * Safe-by-default inbound mission: short, disclosed, no tools, human transfer
 * requires confirmation. Used when no explicit inbound mission is configured
 * but an inbound call must still be answered safely (never unrestricted).
 */
export function createDefaultInboundMission(
  providerId: TelephonyProviderId,
  phoneNumberId: string,
  overrides: Partial<VoiceCallMission> = {},
): VoiceCallMission {
  const now = new Date().toISOString();
  const mission: VoiceCallMission = {
    id: overrides.id ?? randomUUID(),
    sessionId: overrides.sessionId,
    direction: 'inbound',
    providerId,
    phoneNumberId,
    recipientE164: overrides.recipientE164,
    purpose:
      overrides.purpose ??
      'Answer the call, clearly identify as an AI assistant, take a message, and offer human transfer.',
    systemContext: overrides.systemContext,
    allowedActions: overrides.allowedActions ?? ['take_message', 'answer_faq', 'offer_transfer'],
    forbiddenActions: overrides.forbiddenActions ?? ['share_secrets', 'make_payment', 'confirm_identity_by_phone_number'],
    allowedToolIds: overrides.allowedToolIds ?? [],
    requireConfirmationFor: overrides.requireConfirmationFor ?? ['transfer', 'sensitive_action'],
    maxDurationSeconds: overrides.maxDurationSeconds ?? 600,
    maxCostMinorUnits: overrides.maxCostMinorUnits,
    recording: overrides.recording ?? 'off',
    aiDisclosure: overrides.aiDisclosure ?? 'required',
    escalation: overrides.escalation ?? { smsFallback: false, onLowConfidence: 'ask_repeat' },
    stopConditions: overrides.stopConditions ?? ['caller_requests_stop', 'max_duration_reached'],
    status: overrides.status ?? 'armed',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
  assertValidVoiceCallMission(mission);
  return mission;
}
