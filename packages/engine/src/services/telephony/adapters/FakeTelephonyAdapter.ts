import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NormalizedTelephonyEvent, TelephonyCapabilities } from '@agentx/shared';
import { DEFAULT_TELEPHONY_CAPABILITIES } from '@agentx/shared';
import type {
  CredentialValidation,
  InboundCallInstructions,
  OutboundCallRequest,
  ProviderCall,
  ProviderCredentialInput,
  ProviderWebhookInput,
  TelephonyProviderAdapter,
  WebhookVerificationInput,
  WebhookVerificationResult,
} from '../ITelephonyProvider.js';

/**
 * Deterministic telephony adapter for unit/integration tests.
 * Signature: HMAC-SHA256(authToken, rawBody) hex, header `x-agentx-fake-signature`.
 */
export class FakeTelephonyAdapter implements TelephonyProviderAdapter {
  readonly id = 'fake' as const;
  readonly capabilities: TelephonyCapabilities = {
    ...DEFAULT_TELEPHONY_CAPABILITIES,
    inboundCalls: true,
    outboundCalls: true,
    bidirectionalMediaStreams: true,
    dtmf: true,
    recording: true,
    transfer: true,
    sms: true,
    numberProvisioning: true,
    webhookSignatureVerification: true,
    supportedCountries: ['XX'],
  };

  private calls = new Map<string, ProviderCall>();
  private callCounter = 0;

  async validateCredentials(input: ProviderCredentialInput): Promise<CredentialValidation> {
    const token = input.credentials.authToken?.trim();
    if (!token) {
      return { ok: false, message: 'Auth token required' };
    }
    return { ok: true, message: 'Fake credentials accepted', accountLabel: 'fake-account' };
  }

  async createOutboundCall(input: OutboundCallRequest): Promise<ProviderCall> {
    this.callCounter += 1;
    const providerCallId = `fake-call-${this.callCounter}`;
    const call: ProviderCall = { providerCallId, status: 'queued' };
    this.calls.set(providerCallId, call);
    void input;
    return call;
  }

  async endCall(providerCallId: string, _reason: string): Promise<void> {
    const existing = this.calls.get(providerCallId);
    if (existing) {
      this.calls.set(providerCallId, { ...existing, status: 'completed' });
    }
  }

  verifyWebhook(input: WebhookVerificationInput): WebhookVerificationResult {
    const secret = input.credentials.authToken?.trim();
    if (!secret) return { ok: false, reason: 'missing_secret' };
    const header = headerValue(input.headers, 'x-agentx-fake-signature');
    if (!header) return { ok: false, reason: 'missing_signature' };
    const raw = typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString('utf8');
    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    try {
      const a = Buffer.from(header, 'utf8');
      const b = Buffer.from(expected, 'utf8');
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return { ok: false, reason: 'bad_signature' };
      }
    } catch {
      return { ok: false, reason: 'bad_signature' };
    }
    return { ok: true };
  }

  parseWebhook(input: ProviderWebhookInput): NormalizedTelephonyEvent[] {
    const body =
      typeof input.body === 'string'
        ? (safeJson(input.body) ?? {})
        : (input.body as Record<string, unknown>);
    const type = String(body['type'] ?? 'call_started') as NormalizedTelephonyEvent['type'];
    const providerCallId = String(body['providerCallId'] ?? body['CallSid'] ?? 'unknown');
    const providerEventId = String(body['providerEventId'] ?? body['EventId'] ?? `${providerCallId}-${Date.now()}`);
    return [
      {
        type,
        providerCallId,
        providerEventId,
        occurredAt: String(body['occurredAt'] ?? new Date().toISOString()),
        payload: body,
      },
    ];
  }

  buildInboundAnswer(input: {
    providerCallId: string;
    mediaStreamUrl: string;
    disclosureText?: string;
  }): InboundCallInstructions {
    return {
      contentType: 'application/json',
      body: JSON.stringify({
        action: 'connect_stream',
        providerCallId: input.providerCallId,
        mediaStreamUrl: input.mediaStreamUrl,
        disclosureText: input.disclosureText,
      }),
    };
  }

  /** Test helper */
  getCall(providerCallId: string): ProviderCall | undefined {
    return this.calls.get(providerCallId);
  }
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      return Array.isArray(v) ? v[0] : v;
    }
  }
  return undefined;
}

function safeJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
