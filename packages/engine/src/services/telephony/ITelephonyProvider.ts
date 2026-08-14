import type {
  NormalizedTelephonyEvent,
  TelephonyCapabilities,
  TelephonyProviderCatalogEntry,
  TelephonyProviderCredentials,
  TelephonyProviderId,
} from '@agentx/shared';

export interface CredentialValidation {
  ok: boolean;
  message?: string;
  accountLabel?: string;
}

export interface ProviderCredentialInput {
  credentials: TelephonyProviderCredentials;
}

export interface NumberProvisionRequest {
  country: string;
  areaCode?: string;
  friendlyName?: string;
}

export interface PhoneNumberBinding {
  id: string;
  e164: string;
  providerNumberId: string;
  capabilities: { inbound: boolean; outbound: boolean; sms: boolean };
}

export interface OutboundCallRequest {
  fromBindingId: string;
  toE164: string;
  missionId: string;
  webhookBaseUrl: string;
  statusCallbackUrl?: string;
  timeoutSeconds?: number;
  /**
   * Provider credentials for this dial attempt. Supplied by TelephonyDialService
   * (which owns credential lookup) so adapters never read config/secrets directly.
   */
  credentials?: TelephonyProviderCredentials;
}

export interface ProviderCall {
  providerCallId: string;
  status: 'queued' | 'ringing' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
}

export interface TransferCallRequest {
  providerCallId: string;
  toE164: string;
}

export interface SmsRequest {
  fromBindingId: string;
  toE164: string;
  body: string;
}

export interface ProviderMessage {
  providerMessageId: string;
  status: string;
}

export interface WebhookVerificationInput {
  url: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer | string;
  /** Auth token / signing secret for this provider. */
  credentials: TelephonyProviderCredentials;
}

export interface WebhookVerificationResult {
  ok: boolean;
  reason?: string;
}

export interface ProviderWebhookInput {
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown> | string;
  rawBody?: Buffer | string;
}

export interface MediaSessionRequest {
  providerCallId: string;
  callSessionId: string;
  streamUrl: string;
}

export interface ProviderMediaSession {
  providerCallId: string;
  streamSid?: string;
  protocol: 'mulaw' | 'pcm16' | 'unknown';
  sampleRate: number;
}

export interface InboundCallInstructions {
  /** Provider-specific response body (TwiML, XML, JSON, etc.). */
  contentType: string;
  body: string;
}

/**
 * Provider-neutral telephony adapter.
 * Register via TelephonyRegistry — core never branches on vendor SDKs.
 */
export interface TelephonyProviderAdapter {
  readonly id: TelephonyProviderId;
  readonly capabilities: TelephonyCapabilities;
  /** Optional catalog override; otherwise use shipped catalog entry. */
  readonly catalog?: Partial<TelephonyProviderCatalogEntry>;

  validateCredentials(input: ProviderCredentialInput): Promise<CredentialValidation>;
  provisionNumber?(input: NumberProvisionRequest): Promise<PhoneNumberBinding>;
  releaseNumber?(bindingId: string): Promise<void>;
  createOutboundCall(input: OutboundCallRequest): Promise<ProviderCall>;
  endCall(providerCallId: string, reason: string): Promise<void>;
  transferCall?(input: TransferCallRequest): Promise<void>;
  sendMessage?(input: SmsRequest): Promise<ProviderMessage>;
  verifyWebhook(input: WebhookVerificationInput): WebhookVerificationResult;
  parseWebhook(input: ProviderWebhookInput): NormalizedTelephonyEvent[];
  createMediaSession?(input: MediaSessionRequest): Promise<ProviderMediaSession>;
  /**
   * Build the response the provider expects after an inbound webhook
   * (e.g. TwiML Connect + Stream).
   */
  buildInboundAnswer?(input: {
    providerCallId: string;
    mediaStreamUrl: string;
    disclosureText?: string;
  }): InboundCallInstructions;
}
