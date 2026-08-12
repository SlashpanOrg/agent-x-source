import { describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  FakeTelephonyAdapter,
  TelephonyRegistry,
  TwilioAdapter,
  bootstrapTelephonyAdapters,
  setTelephonyRegistry,
  setTelephonyService,
} from '@agentx/engine';
import { classifyIPv4, classifyIPv6, deriveExposureState } from '../src/host/discovery.js';
import { isPublicEdgePathAllowed } from '../src/host/middleware/public-edge-policy.js';
import { isTelephonyWebhookPath } from '../src/auth.js';
import { FakeEdgeProvider } from '../src/host/providers/FakeEdgeProvider.js';
import {
  HostGateway,
  setHostGateway,
  PublicEdgeRegistry,
} from '../src/host/index.js';
import { __resetTelephonyReplayCache } from '../src/telephony/middleware/webhook-auth.js';

describe('host IP classification', () => {
  it('classifies private / loopback / cgnat / public IPv4', () => {
    expect(classifyIPv4('127.0.0.1', true)).toBe('loopback');
    expect(classifyIPv4('10.0.0.5', false)).toBe('private');
    expect(classifyIPv4('192.168.1.10', false)).toBe('private');
    expect(classifyIPv4('172.16.0.1', false)).toBe('private');
    expect(classifyIPv4('100.64.1.2', false)).toBe('cgnat');
    expect(classifyIPv4('8.8.8.8', false)).toBe('public');
    expect(classifyIPv4('169.254.1.1', false)).toBe('link_local');
  });

  it('classifies IPv6 scopes', () => {
    expect(classifyIPv6('::1', true)).toBe('loopback');
    expect(classifyIPv6('fe80::1', false)).toBe('link_local');
    expect(classifyIPv6('fd12:3456::1', false)).toBe('private');
    expect(classifyIPv6('2001:db8::1', false)).toBe('public');
  });

  it('derives exposure states', () => {
    const network = {
      bindHost: '127.0.0.1',
      bindPort: 3333,
      loopbackUrl: 'http://127.0.0.1:3333',
      lanUrls: [],
      addresses: [],
      publicIp: null,
      publicIpConfidence: 'none' as const,
      natUncertainty: false,
    };
    expect(
      deriveExposureState({
        publicAccess: false,
        tunnel: {
          providerId: null,
          state: 'disabled',
          verifiedUpstream: false,
        },
        network,
      }),
    ).toBe('LOCAL_ONLY');

    expect(
      deriveExposureState({
        publicAccess: true,
        tunnel: {
          providerId: 'fake',
          state: 'active',
          publicUrl: 'https://x.example',
          verifiedUpstream: true,
        },
        network,
      }),
    ).toBe('PUBLIC_TUNNEL_SECURED');
  });
});

describe('public edge allowlist', () => {
  it('allows intended routes and denies internals', () => {
    expect(isPublicEdgePathAllowed('/api/host/status')).toBe(true);
    expect(isPublicEdgePathAllowed('/api/telephony/twilio/inbound')).toBe(true);
    expect(isPublicEdgePathAllowed('/api/auth/login')).toBe(true);
    expect(isPublicEdgePathAllowed('/api/observability/traces')).toBe(false);
    expect(isPublicEdgePathAllowed('/api/jobs')).toBe(false);
    expect(isPublicEdgePathAllowed('/metrics')).toBe(false);
  });
});

describe('telephony webhook auth path', () => {
  it('matches webhook paths but not provider management', () => {
    expect(isTelephonyWebhookPath('/api/telephony/twilio/inbound')).toBe(true);
    expect(isTelephonyWebhookPath('/api/telephony/fake/status')).toBe(true);
    expect(isTelephonyWebhookPath('/api/telephony/providers')).toBe(false);
    expect(isTelephonyWebhookPath('/api/telephony/providers/twilio/capabilities')).toBe(false);
  });
});

describe('telephony registry + fake adapter', () => {
  beforeEach(() => {
    setTelephonyService(null);
    setTelephonyRegistry(null);
    __resetTelephonyReplayCache();
  });

  it('registers adapters plug-n-play and verifies fake signatures', async () => {
    const service = bootstrapTelephonyAdapters({ includeFake: true });
    const fake = service.getRegistry().get('fake') as FakeTelephonyAdapter;
    expect(fake).toBeTruthy();

    const authToken = 'test-secret';
    const rawBody = JSON.stringify({ type: 'call_started', providerCallId: 'c1', providerEventId: 'e1' });
    const signature = createHmac('sha256', authToken).update(rawBody).digest('hex');

    const ok = fake.verifyWebhook({
      url: 'https://example.test/api/telephony/fake/inbound',
      method: 'POST',
      headers: { 'x-agentx-fake-signature': signature },
      rawBody,
      credentials: { authToken },
    });
    expect(ok.ok).toBe(true);

    const bad = fake.verifyWebhook({
      url: 'https://example.test/api/telephony/fake/inbound',
      method: 'POST',
      headers: { 'x-agentx-fake-signature': 'deadbeef' },
      rawBody,
      credentials: { authToken },
    });
    expect(bad.ok).toBe(false);

    const events = fake.parseWebhook({ headers: {}, body: JSON.parse(rawBody) });
    expect(events[0]?.type).toBe('call_started');
  });

  it('lists catalog with capability negotiation', () => {
    const registry = new TelephonyRegistry();
    registry.register(new TwilioAdapter({ fetchImpl: async () => new Response('{}', { status: 200 }) }));
    const entry = registry.getCatalogEntry('twilio');
    expect(entry?.capabilities.inboundCalls).toBe(true);
    expect(registry.hasCapability('twilio', 'outboundCalls')).toBe(true);
    expect(registry.hasCapability('missing', 'inboundCalls')).toBe(false);
  });
});

describe('fake edge provider + host gateway', () => {
  it('starts and stops a fake tunnel', async () => {
    const registry = new PublicEdgeRegistry();
    registry.register(new FakeEdgeProvider());
    const gateway = new HostGateway({
      bindHost: '127.0.0.1',
      bindPort: 3333,
      registry,
      includeFake: false,
    });
    setHostGateway(gateway);
    gateway.applyConfig({
      provider: 'fake',
      tunnelProviders: {
        fake: { credentials: { authToken: 'tok' } },
      },
    });

    const started = await gateway.startTunnel('fake');
    expect(started.state).toBe('active');
    expect(started.publicUrl).toContain('https://fake-tunnel.example');

    const stopped = await gateway.stopTunnel();
    expect(stopped.state).toBe('stopped');
    setHostGateway(null);
  });
});

describe('twilio signature verify', () => {
  it('accepts a valid Twilio-style signature', () => {
    const adapter = new TwilioAdapter({
      fetchImpl: async () => new Response('{}', { status: 200 }),
    });
    const authToken = '12345';
    const url = 'https://example.com/api/telephony/twilio/inbound';
    const params = { CallSid: 'CA123', CallStatus: 'ringing' };
    const rawBody = new URLSearchParams(params).toString();
    const data = url + Object.keys(params).sort().map((k) => `${k}${params[k as keyof typeof params]}`).join('');
    const signature = createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');

    const result = adapter.verifyWebhook({
      url,
      method: 'POST',
      headers: { 'x-twilio-signature': signature },
      rawBody,
      credentials: { authToken },
    });
    expect(result.ok).toBe(true);

    const events = adapter.parseWebhook({ headers: {}, body: params });
    expect(events[0]?.type).toBe('ringing');
  });
});
