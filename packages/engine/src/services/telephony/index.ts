export type {
  TelephonyProviderAdapter,
  CredentialValidation,
  ProviderCredentialInput,
  OutboundCallRequest,
  ProviderCall,
  WebhookVerificationInput,
  WebhookVerificationResult,
  ProviderWebhookInput,
  InboundCallInstructions,
  MediaSessionRequest,
  ProviderMediaSession,
  PhoneNumberBinding,
  NumberProvisionRequest,
  TransferCallRequest,
  SmsRequest,
  ProviderMessage,
} from './ITelephonyProvider.js';

export {
  TelephonyRegistry,
  getTelephonyRegistry,
  setTelephonyRegistry,
  SHIPPED_TELEPHONY_CATALOG,
} from './TelephonyRegistry.js';

export {
  TelephonyService,
  getTelephonyService,
  setTelephonyService,
  bootstrapTelephonyAdapters,
} from './TelephonyService.js';
export type { TelephonyServiceOptions } from './TelephonyService.js';

export { FakeTelephonyAdapter } from './adapters/FakeTelephonyAdapter.js';
export { TwilioAdapter } from './adapters/TwilioAdapter.js';

// Voice call domain (Host/VOIP H4)
export { redactE164, hashE164, normalizeE164 } from './phone-redaction.js';

export {
  validateVoiceCallMission,
  assertValidVoiceCallMission,
  createDefaultInboundMission,
  MIN_MISSION_DURATION_SECONDS,
  MAX_MISSION_DURATION_SECONDS,
} from './mission-validation.js';
export type { MissionValidationIssue, MissionValidationResult } from './mission-validation.js';

export {
  CallSessionStateMachine,
  IllegalCallSessionTransitionError,
  TERMINAL_CALL_SESSION_STATES,
  transition as transitionCallSessionState,
} from './CallSessionStateMachine.js';
export type { CallSessionState } from './CallSessionStateMachine.js';

export { VoiceCallStore, getVoiceCallStore, setVoiceCallStore } from './VoiceCallStore.js';
export type {
  VoiceCallSession,
  VoiceCallSessionWrite,
  VoiceCallEvent,
  VoiceCallConsent,
  VoiceCallProviderBinding,
  VoiceCallProviderBindingWrite,
  HostSecurityEvent,
  VoiceCallStoreOptions,
  ListMissionsFilter,
  ListSessionsFilter,
  AppendEventInput,
  AppendEventResult,
  SaveConsentInput,
  AppendSecurityEventInput,
} from './VoiceCallStore.js';

export { TelephonyDialService, TelephonyDialError, getTelephonyDialService, setTelephonyDialService } from './TelephonyDialService.js';
export type {
  DialInput,
  DialResult,
  TelephonyDialServiceOptions,
  TelephonyDialErrorCode,
} from './TelephonyDialService.js';

export { CallerPolicy } from './CallerPolicy.js';
export type { CallerPolicyDecision, CallerPolicyResult, CallerPolicyOptions } from './CallerPolicy.js';
