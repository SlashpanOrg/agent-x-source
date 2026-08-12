import { createHmac } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import type { TelephonyProviderCredentials } from '@agentx/shared';
import { FakeTelephonyAdapter } from '../src/services/telephony/adapters/FakeTelephonyAdapter.js';
import { TwilioAdapter } from '../src/services/telephony/adapters/TwilioAdapter.js';
import type { TelephonyProviderAdapter } from '../src/services/telephony/ITelephonyProvider.js';

interface WebhookFixture {
  url: string;
  method: string;
  headers: Record<string, string>;
  rawBody: string;
}

interface AdapterFixture {
  name: string;
  adapter: TelephonyProviderAdapter;
  validCredentials: TelephonyProviderCredentials;
  invalidCredentials: TelephonyProviderCredentials;
  buildValidWebhook: () => WebhookFixture;
}

function createMockFetch(): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      sid: 'AC_test',
      friendly_name: 'Test Account',
      status: 'queued',
    }),
  })) as unknown as typeof fetch;
}

function buildFixtures(): AdapterFixture[] {
  const fakeCredentials: TelephonyProviderCredentials = { authToken: 'fake-shared-secret' };
  const twilioCredentials: TelephonyProviderCredentials = {
    accountId: `AC${'a'.repeat(32)}`,
    authToken: 'twilio-shared-secret',
  };

  return [
    {
      name: 'fake',
      adapter: new FakeTelephonyAdapter(),
      validCredentials: fakeCredentials,
      invalidCredentials: {},
      buildValidWebhook: () => {
        const rawBody = JSON.stringify({ type: 'call_started', providerCallId: 'fake-call-1' });
        const signature = createHmac('sha256', fakeCredentials.authToken!).update(rawBody).digest('hex');
        return {
          url: 'https://example.com/api/telephony/webhooks/fake',
          method: 'POST',
          headers: { 'x-agentx-fake-signature': signature },
          rawBody,
        };
      },
    },
    {
      name: 'twilio',
      adapter: new TwilioAdapter({ fetchImpl: createMockFetch() }),
      validCredentials: twilioCredentials,
      invalidCredentials: { accountId: 'not-a-valid-sid', authToken: '' },
      buildValidWebhook: () => {
        const url = 'https://example.com/api/telephony/webhooks/twilio';
        const rawBody = 'CallSid=CA123&CallStatus=ringing';
        const params: Record<string, string> = { CallSid: 'CA123', CallStatus: 'ringing' };
        const data =
          url +
          Object.keys(params)
            .sort()
            .map((key) => `${key}${params[key]}`)
            .join('');
        const signature = createHmac('sha1', twilioCredentials.authToken!)
          .update(Buffer.from(data, 'utf8'))
          .digest('base64');
        return {
          url,
          method: 'POST',
          headers: { 'x-twilio-signature': signature },
          rawBody,
        };
      },
    },
  ];
}

/**
 * Every telephony adapter must satisfy the same provider-neutral contract —
 * this suite runs identically against Fake and Twilio (mocked fetch) so a new
 * adapter can't silently diverge from the interface.
 */
describe.each(buildFixtures().map((fixture) => [fixture.name, fixture] as const))(
  'telephony adapter contract: %s',
  (_name, fixture) => {
    it('declares webhook signature verification support', () => {
      expect(fixture.adapter.capabilities.webhookSignatureVerification).toBe(true);
    });

    it('validateCredentials returns a well-formed result for valid credentials', async () => {
      const result = await fixture.adapter.validateCredentials({ credentials: fixture.validCredentials });
      expect(typeof result.ok).toBe('boolean');
      expect(result.ok).toBe(true);
      if (result.message != null) expect(typeof result.message).toBe('string');
    });

    it('validateCredentials rejects malformed/missing credentials', async () => {
      const result = await fixture.adapter.validateCredentials({ credentials: fixture.invalidCredentials });
      expect(result.ok).toBe(false);
      expect(typeof result.message).toBe('string');
    });

    it('verifyWebhook accepts a correctly signed request', () => {
      const webhook = fixture.buildValidWebhook();
      const result = fixture.adapter.verifyWebhook({ ...webhook, credentials: fixture.validCredentials });
      expect(result.ok).toBe(true);
    });

    it('verifyWebhook rejects a tampered signature', () => {
      const webhook = fixture.buildValidWebhook();
      const tamperedHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(webhook.headers)) {
        tamperedHeaders[key] = `${value}-tampered`;
      }
      const result = fixture.adapter.verifyWebhook({
        ...webhook,
        headers: tamperedHeaders,
        credentials: fixture.validCredentials,
      });
      expect(result.ok).toBe(false);
      expect(typeof result.reason).toBe('string');
    });

    it('verifyWebhook rejects when no secret is configured', () => {
      const webhook = fixture.buildValidWebhook();
      const result = fixture.adapter.verifyWebhook({ ...webhook, credentials: {} });
      expect(result.ok).toBe(false);
    });

    it('parseWebhook yields normalized telephony events', () => {
      const webhook = fixture.buildValidWebhook();
      const events = fixture.adapter.parseWebhook({
        headers: webhook.headers,
        body: webhook.rawBody,
        rawBody: webhook.rawBody,
      });
      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(typeof event.type).toBe('string');
        expect(typeof event.providerCallId).toBe('string');
        expect(event.providerCallId.length).toBeGreaterThan(0);
        expect(typeof event.providerEventId).toBe('string');
        expect(event.providerEventId.length).toBeGreaterThan(0);
        expect(typeof event.occurredAt).toBe('string');
        expect(event.payload).toBeTypeOf('object');
      }
    });

    it('buildInboundAnswer returns provider-ready instructions', () => {
      expect(fixture.adapter.buildInboundAnswer).toBeTypeOf('function');
      const instructions = fixture.adapter.buildInboundAnswer!({
        providerCallId: 'contract-test-call',
        mediaStreamUrl: 'wss://example.com/media/contract-test-call',
        disclosureText: 'This call may be recorded and is handled by an AI assistant.',
      });
      expect(typeof instructions.contentType).toBe('string');
      expect(instructions.contentType.length).toBeGreaterThan(0);
      expect(typeof instructions.body).toBe('string');
      expect(instructions.body.length).toBeGreaterThan(0);
    });
  },
);
