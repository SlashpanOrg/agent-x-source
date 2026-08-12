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
  TransferCallRequest,
  WebhookVerificationInput,
  WebhookVerificationResult,
} from '../ITelephonyProvider.js';

/**
 * Twilio adapter — signature verify + webhook normalize + TwiML answer.
 * Outbound dial uses Twilio REST when credentials are present; media bridge
 * hooks into VoiceEngineSession separately.
 */
export class TwilioAdapter implements TelephonyProviderAdapter {
  readonly id = 'twilio' as const;
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
    supportedCountries: ['US', 'CA', 'GB', 'AU', 'IN', 'DE', 'FR', 'SG'],
  };

  private readonly fetchImpl: typeof fetch;

  constructor(options?: { fetchImpl?: typeof fetch }) {
    this.fetchImpl = options?.fetchImpl ?? fetch;
  }

  async validateCredentials(input: ProviderCredentialInput): Promise<CredentialValidation> {
    const accountSid = input.credentials.accountId?.trim();
    const authToken = input.credentials.authToken?.trim();
    if (!accountSid || !authToken) {
      return { ok: false, message: 'Account SID and Auth Token are required' };
    }
    if (!/^AC[a-f0-9]{32}$/i.test(accountSid)) {
      return { ok: false, message: 'Account SID looks invalid (expected AC…).' };
    }
    try {
      const res = await this.fetchImpl(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}.json`,
        {
          headers: {
            Authorization: basicAuth(accountSid, authToken),
          },
        },
      );
      if (!res.ok) {
        return { ok: false, message: `Twilio rejected credentials (${res.status})` };
      }
      const data = (await res.json()) as { friendly_name?: string; sid?: string };
      return {
        ok: true,
        message: 'Twilio credentials verified',
        accountLabel: data.friendly_name ?? data.sid ?? accountSid,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : 'Network error validating Twilio credentials',
      };
    }
  }

  async createOutboundCall(input: OutboundCallRequest): Promise<ProviderCall> {
    const accountSid = input.credentials?.accountId?.trim();
    const authToken = input.credentials?.authToken?.trim();
    if (!accountSid || !authToken) {
      throw new Error(
        'Twilio outbound requires credentials — dial via TelephonyDialService (accountId, authToken).',
      );
    }
    const from =
      input.credentials?.extras?.['callerId']?.trim() ||
      (input.fromBindingId.startsWith('+') ? input.fromBindingId : undefined);
    if (!from) {
      throw new Error(
        'Twilio outbound requires a From number — set credentials.extras.callerId or bind an E.164 number.',
      );
    }

    const body = new URLSearchParams({
      From: from,
      To: input.toE164,
      Url: input.webhookBaseUrl,
      ...(input.statusCallbackUrl ? { StatusCallback: input.statusCallbackUrl } : {}),
      ...(input.timeoutSeconds ? { Timeout: String(input.timeoutSeconds) } : {}),
    });

    const res = await this.fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls.json`,
      {
        method: 'POST',
        headers: {
          Authorization: basicAuth(accountSid, authToken),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      },
    );

    if (!res.ok) {
      let message = `Twilio outbound call failed (${res.status})`;
      try {
        const err = (await res.json()) as { message?: string };
        if (err.message) message = `Twilio outbound call failed: ${err.message}`;
      } catch {
        /* body wasn't JSON — keep the generic message */
      }
      throw new Error(message);
    }

    const data = (await res.json()) as { sid?: string; status?: string };
    if (!data.sid) throw new Error('Twilio outbound call response missing sid');
    return { providerCallId: data.sid, status: mapTwilioCallStatus(data.status) };
  }

  async endCall(_providerCallId: string, _reason: string): Promise<void> {
    throw new Error('Twilio endCall requires TelephonyService');
  }

  async transferCall(_input: TransferCallRequest): Promise<void> {
    throw new Error('Twilio transferCall requires TelephonyService');
  }

  /**
   * Twilio request validation:
   * https://www.twilio.com/docs/usage/security#validating-requests
   * HMAC-SHA1(authToken, url + sorted(params)) base64 compared to X-Twilio-Signature.
   */
  verifyWebhook(input: WebhookVerificationInput): WebhookVerificationResult {
    const authToken = input.credentials.authToken?.trim();
    if (!authToken) return { ok: false, reason: 'missing_secret' };
    const signature = headerValue(input.headers, 'x-twilio-signature');
    if (!signature) return { ok: false, reason: 'missing_signature' };

    const raw = typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString('utf8');
    const params = parseFormOrJson(raw);
    const data = input.url + sortedParamString(params);
    const expected = createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');

    try {
      const a = Buffer.from(signature, 'utf8');
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
        ? parseFormOrJson(input.body)
        : (input.body as Record<string, unknown>);

    const callSid = String(body['CallSid'] ?? body['call_sid'] ?? '');
    const callStatus = String(body['CallStatus'] ?? body['call_status'] ?? '').toLowerCase();
    const digits = body['Digits'] != null ? String(body['Digits']) : undefined;
    const eventId = String(body['SequenceNumber'] ?? body['EventId'] ?? `${callSid}-${callStatus || 'event'}-${Date.now()}`);

    let type: NormalizedTelephonyEvent['type'] = 'call_started';
    if (digits != null) type = 'dtmf';
    else if (callStatus === 'ringing') type = 'ringing';
    else if (callStatus === 'in-progress' || callStatus === 'answered') type = 'connected';
    else if (callStatus === 'completed') type = 'completed';
    else if (callStatus === 'busy' || callStatus === 'failed' || callStatus === 'no-answer') type = 'failed';
    else if (callStatus === 'canceled' || callStatus === 'cancelled') type = 'cancelled';
    else if (body['RecordingUrl'] || body['RecordingSid']) type = 'recording_ready';
    else if (!callStatus && callSid) type = 'call_started';

    return [
      {
        type,
        providerCallId: callSid || 'unknown',
        providerEventId: eventId,
        occurredAt: new Date().toISOString(),
        payload: body,
      },
    ];
  }

  buildInboundAnswer(input: {
    providerCallId: string;
    mediaStreamUrl: string;
    disclosureText?: string;
  }): InboundCallInstructions {
    const say = input.disclosureText
      ? `<Say>${escapeXml(input.disclosureText)}</Say>`
      : '';
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say}
  <Connect>
    <Stream url="${escapeXml(input.mediaStreamUrl)}" />
  </Connect>
</Response>`;
    return { contentType: 'text/xml', body: twiml };
  }
}

function basicAuth(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

function mapTwilioCallStatus(status?: string): ProviderCall['status'] {
  switch ((status ?? '').toLowerCase()) {
    case 'ringing':
      return 'ringing';
    case 'in-progress':
    case 'answered':
      return 'in_progress';
    case 'completed':
      return 'completed';
    case 'busy':
    case 'failed':
    case 'no-answer':
      return 'failed';
    case 'canceled':
    case 'cancelled':
      return 'cancelled';
    default:
      return 'queued';
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

function parseFormOrJson(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      /* fall through to form */
    }
  }
  const out: Record<string, unknown> = {};
  const params = new URLSearchParams(trimmed);
  for (const [k, v] of params.entries()) {
    out[k] = v;
  }
  return out;
}

function sortedParamString(params: Record<string, unknown>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${k}${String(params[k] ?? '')}`)
    .join('');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
