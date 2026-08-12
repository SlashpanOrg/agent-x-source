/**
 * Provider-neutral telephony contracts for Agent-X Host / VOIP.
 * Adapters implement these; core never imports vendor SDKs.
 */

/** Stable provider ids. New vendors register without changing core branching. */
export type TelephonyProviderId = 'twilio' | 'fake' | (string & {});

export type TelephonyRecordingPolicy = 'off' | 'on_with_disclosure' | 'provider_default';

export type TelephonyAiDisclosure = 'required' | 'automatic' | 'disabled_only_if_legal';

export type VoiceCallDirection = 'inbound' | 'outbound';

export type VoiceCallMissionStatus =
  | 'draft'
  | 'armed'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type NormalizedTelephonyEventType =
  | 'call_started'
  | 'ringing'
  | 'connected'
  | 'media_ready'
  | 'dtmf'
  | 'recording_ready'
  | 'transferred'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TelephonyCapabilities {
  inboundCalls: boolean;
  outboundCalls: boolean;
  bidirectionalMediaStreams: boolean;
  dtmf: boolean;
  recording: boolean;
  transcription: boolean;
  transfer: boolean;
  sms: boolean;
  numberProvisioning: boolean;
  webhookSignatureVerification: boolean;
  supportedCountries: string[];
}

/** Declarative UI/setup metadata — drives plug-n-play Host → VOIP cards. */
export interface TelephonyCredentialField {
  key: string;
  label: string;
  /** When true, value is encrypted at rest and never returned to the client. */
  secret?: boolean;
  placeholder?: string;
  helperText?: string;
  required?: boolean;
}

export interface TelephonyProviderCatalogEntry {
  id: TelephonyProviderId;
  name: string;
  tagline: string;
  /** Accent hint for Host UI (css color or brand token). */
  accent?: string;
  setupSteps: string[];
  credentialFields: TelephonyCredentialField[];
  capabilities: TelephonyCapabilities;
  /** Regions/countries highlighted in the UI. */
  highlightedCountries?: string[];
  /** When true, shown only in developer/test surfaces. */
  testingOnly?: boolean;
}

export interface TelephonyProviderCredentials {
  /** Account / SID / API key id — non-secret identifiers. */
  accountId?: string;
  /** Auth token / API secret — write-only from client. */
  authToken?: string;
  /** Server → client: whether a secret is stored. Client → server: false clears it. */
  authTokenConfigured?: boolean;
  /** Optional API key pair for providers that separate key + secret. */
  apiKey?: string;
  apiKeyConfigured?: boolean;
  apiSecret?: string;
  apiSecretConfigured?: boolean;
  /** Provider-specific non-secret knobs (region, app id, etc.). */
  extras?: Record<string, string>;
}

export interface TelephonyNumberBindingConfig {
  /** Local binding id (Agent-X). */
  id: string;
  /** E.164 number when known. */
  e164?: string;
  /** Provider-side number / SID. */
  providerNumberId?: string;
  label?: string;
  inboundEnabled?: boolean;
  outboundEnabled?: boolean;
}

export interface TelephonyProviderConfig {
  enabled?: boolean;
  credentials?: TelephonyProviderCredentials;
  numbers?: TelephonyNumberBindingConfig[];
}

/** Draft fields for the safe-by-default inbound mission editor in Host → VOIP. */
export interface TelephonyDefaultInboundMissionDraft {
  purpose?: string;
  maxDurationSeconds?: number;
  recording?: TelephonyRecordingPolicy;
  aiDisclosure?: TelephonyAiDisclosure;
  transferNumber?: string;
}

/**
 * Simple user-facing VOIP config. Pick a provider, paste credentials, bind a number.
 * Secrets never appear in the public/redacted shape.
 */
export interface TelephonyConfig {
  /** Active provider for inbound/outbound. */
  activeProviderId?: TelephonyProviderId | null;
  inboundEnabled?: boolean;
  outboundEnabled?: boolean;
  /** Require explicit human approval before any outbound call dials (mission-level confirmation remains authoritative). */
  requireApproval?: boolean;
  defaultMissionId?: string | null;
  /** Draft fields for the default/safe inbound mission editor — persisted independent of the armed mission. */
  defaultInboundMission?: TelephonyDefaultInboundMissionDraft;
  recording?: TelephonyRecordingPolicy;
  aiDisclosure?: TelephonyAiDisclosure;
  maxDurationSeconds?: number;
  maxConcurrentCalls?: number;
  /** Per-provider credentials and number bindings — keyed by provider id. */
  providers?: Record<string, TelephonyProviderConfig>;
  /** E.164 numbers always allowed to reach an inbound mission, bypassing unknown-caller policy. */
  callerAllowlist?: string[];
  /** E.164 numbers always rejected before any mission is loaded. */
  callerBlocklist?: string[];
  /** Hard cap on total call spend per UTC day, in provider minor currency units. */
  dailySpendCapMinorUnits?: number;
}

export interface VoiceCallMissionEscalation {
  transferNumber?: string;
  smsFallback?: boolean;
  onLowConfidence?: 'ask_repeat' | 'transfer' | 'end';
}

export interface VoiceCallMission {
  id: string;
  sessionId?: string;
  direction: VoiceCallDirection;
  providerId: TelephonyProviderId;
  phoneNumberId: string;
  recipientE164?: string;
  purpose: string;
  systemContext?: string;
  allowedActions: string[];
  forbiddenActions: string[];
  allowedToolIds: string[];
  requireConfirmationFor: string[];
  maxDurationSeconds: number;
  maxCostMinorUnits?: number;
  recording: TelephonyRecordingPolicy;
  aiDisclosure: TelephonyAiDisclosure;
  escalation: VoiceCallMissionEscalation;
  stopConditions: string[];
  status: VoiceCallMissionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface NormalizedTelephonyEvent {
  type: NormalizedTelephonyEventType;
  providerCallId: string;
  providerEventId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export const DEFAULT_TELEPHONY_CAPABILITIES: TelephonyCapabilities = {
  inboundCalls: false,
  outboundCalls: false,
  bidirectionalMediaStreams: false,
  dtmf: false,
  recording: false,
  transcription: false,
  transfer: false,
  sms: false,
  numberProvisioning: false,
  webhookSignatureVerification: false,
  supportedCountries: [],
};

export function defaultTelephonyConfig(): TelephonyConfig {
  return {
    activeProviderId: null,
    inboundEnabled: false,
    outboundEnabled: false,
    requireApproval: true,
    defaultMissionId: null,
    recording: 'off',
    aiDisclosure: 'required',
    maxDurationSeconds: 600,
    maxConcurrentCalls: 1,
    providers: {},
  };
}

export function mergeTelephonyConfig(
  existing?: TelephonyConfig | null,
  incoming?: TelephonyConfig | null,
): TelephonyConfig {
  const base = defaultTelephonyConfig();
  if (!existing && !incoming) return base;
  const mergedProviders: Record<string, TelephonyProviderConfig> = {
    ...(base.providers ?? {}),
    ...(existing?.providers ?? {}),
  };
  for (const [id, cfg] of Object.entries(incoming?.providers ?? {})) {
    const prev = mergedProviders[id] ?? {};
    mergedProviders[id] = {
      ...prev,
      ...cfg,
      credentials: {
        ...prev.credentials,
        ...cfg.credentials,
      },
      numbers: cfg.numbers ?? prev.numbers,
    };
  }
  return {
    ...base,
    ...existing,
    ...incoming,
    providers: mergedProviders,
  };
}
