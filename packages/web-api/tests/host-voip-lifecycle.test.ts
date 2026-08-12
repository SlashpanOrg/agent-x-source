import { describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  bootstrapTelephonyAdapters,
  setTelephonyService,
  setTelephonyRegistry,
  setVoiceCallStore,
  VoiceCallStore,
  createDefaultInboundMission,
  validateVoiceCallMission,
  CallSessionStateMachine,
  getTelephonyDialService,
  setTelephonyDialService,
  TelephonyDialService,
  FakeTelephonyAdapter,
  redactE164,
} from '@agentx/engine';
import {
  handleInboundCallEvents,
  handleStatusOrRecordingEvents,
  __clearInboundTimeouts,
} from '../src/telephony/inbound-engine.js';
import { runVoiceCallRetentionJob } from '../src/telephony/retention.js';
import { isPublicEdgePathAllowed } from '../src/host/middleware/public-edge-policy.js';
import { HostGateway, setHostGateway, PublicEdgeRegistry } from '../src/host/index.js';
import { FakeEdgeProvider } from '../src/host/providers/FakeEdgeProvider.js';

describe('inbound call lifecycle', () => {
  beforeEach(() => {
    setTelephonyService(null);
    setTelephonyRegistry(null);
    setVoiceCallStore(new VoiceCallStore());
    setTelephonyDialService(null);
    __clearInboundTimeouts();
    const registry = new PublicEdgeRegistry();
    registry.register(new FakeEdgeProvider());
    const gateway = new HostGateway({
      bindHost: '127.0.0.1',
      bindPort: 3333,
      registry,
      includeFake: false,
    });
    gateway.applyConfig({
      exposure: { web: true, voice: false, telephonyWebhooks: true },
      telephony: {
        inboundEnabled: true,
        outboundEnabled: true,
        activeProviderId: 'fake',
        maxConcurrentCalls: 2,
        providers: {
          fake: {
            enabled: true,
            credentials: { authToken: 'secret' },
            numbers: [{ id: 'n1', e164: '+15551212', inboundEnabled: true, outboundEnabled: true }],
          },
        },
      },
    });
    setHostGateway(gateway);
    const tel = bootstrapTelephonyAdapters({ includeFake: true });
    tel.applyConfig(gateway.getConfig().telephony);
  });

  it('creates a restricted session on inbound webhook events', async () => {
    const result = await handleInboundCallEvents({
      providerId: 'fake',
      events: [
        {
          type: 'call_started',
          providerCallId: 'PC-in-1',
          providerEventId: 'EV-1',
          occurredAt: new Date().toISOString(),
          payload: { From: '+15550001', To: '+15551212' },
        },
      ],
    });
    expect(result.rejected).toBe(false);
    expect(result.session?.providerCallId).toBe('PC-in-1');
    expect(result.session?.fromE164Redacted).toContain('***');
    expect(result.disclosureText).toMatch(/AI/i);
  });

  it('blocks opted-out callers', async () => {
    const store = new VoiceCallStore();
    setVoiceCallStore(store);
    const { hashE164 } = await import('@agentx/engine');
    await store.saveConsent({
      e164Hash: hashE164('+15550099'),
      e164Redacted: redactE164('+15550099'),
      consentType: 'opt_out',
      granted: true,
    });
    const result = await handleInboundCallEvents({
      providerId: 'fake',
      events: [
        {
          type: 'call_started',
          providerCallId: 'PC-block',
          providerEventId: 'EV-b',
          occurredAt: new Date().toISOString(),
          payload: { From: '+15550099', To: '+15551212' },
        },
      ],
    });
    expect(result.rejected).toBe(true);
  });

  it('maps status webhooks to terminal states', async () => {
    await handleInboundCallEvents({
      providerId: 'fake',
      events: [
        {
          type: 'call_started',
          providerCallId: 'PC-status',
          providerEventId: 'EV-s1',
          occurredAt: new Date().toISOString(),
          payload: { From: '+15550002', To: '+15551212' },
        },
      ],
    });
    await handleStatusOrRecordingEvents({
      providerId: 'fake',
      kind: 'status',
      events: [
        {
          type: 'completed',
          providerCallId: 'PC-status',
          providerEventId: 'EV-s2',
          occurredAt: new Date().toISOString(),
          payload: {},
        },
      ],
    });
    const store = (await import('@agentx/engine')).getVoiceCallStore();
    const session = await store.getSessionByProviderCall('fake', 'PC-status');
    expect(session?.state).toBe('completed');
  });
});

describe('outbound dial + approval', () => {
  beforeEach(() => {
    setTelephonyService(null);
    setTelephonyRegistry(null);
    setVoiceCallStore(new VoiceCallStore());
    setTelephonyDialService(null);
    bootstrapTelephonyAdapters({ includeFake: true });
  });

  it('requires approval for first-time recipients when configured', async () => {
    const store = new VoiceCallStore();
    setVoiceCallStore(store);
    const now = new Date().toISOString();
    const mission = {
      id: 'mission-out-1',
      direction: 'outbound' as const,
      providerId: 'fake',
      phoneNumberId: 'n1',
      recipientE164: '+15551112222',
      purpose: 'Remind about appointment',
      allowedActions: [] as string[],
      forbiddenActions: [] as string[],
      allowedToolIds: [] as string[],
      requireConfirmationFor: ['first_recipient'],
      maxDurationSeconds: 600,
      recording: 'off' as const,
      aiDisclosure: 'required' as const,
      escalation: { onLowConfidence: 'ask_repeat' as const },
      stopConditions: [] as string[],
      status: 'armed' as const,
      createdAt: now,
      updatedAt: now,
    };
    await store.saveMission(mission);
    await store.saveBinding({
      id: 'n1',
      providerId: 'fake',
      providerNumberId: 'PN1',
      e164: '+15551212',
      e164Redacted: redactE164('+15551212'),
      inboundEnabled: true,
      outboundEnabled: true,
      createdAt: now,
      updatedAt: now,
    });

    bootstrapTelephonyAdapters({ includeFake: true });
    const { getTelephonyService } = await import('@agentx/engine');
    getTelephonyService().applyConfig({
      activeProviderId: 'fake',
      outboundEnabled: true,
      inboundEnabled: true,
    });
    const dial = new TelephonyDialService({ store, telephonyService: getTelephonyService() });
    setTelephonyDialService(dial);

    await expect(
      dial.dial({
        missionId: mission.id,
        webhookBaseUrl: 'https://example.test',
        approved: false,
      }),
    ).rejects.toMatchObject({ code: 'approval_required' });

    const ok = await dial.dial({
      missionId: mission.id,
      webhookBaseUrl: 'https://example.test',
      approved: true,
    });
    expect(ok.providerCall.providerCallId).toBeTruthy();

    await dial.cancel(ok.session.id);
    const cancelled = await store.getSession(ok.session.id);
    expect(['cancelled', 'completed']).toContain(cancelled?.state);
  });
});

describe('mission validation + state machine', () => {
  it('rejects invalid missions', () => {
    const result = validateVoiceCallMission({
      purpose: '',
      providerId: 'twilio',
      phoneNumberId: 'x',
      direction: 'inbound',
      maxDurationSeconds: 5,
    });
    expect(result.ok).toBe(false);
  });

  it('enforces legal transitions', () => {
    expect(CallSessionStateMachine.transition('created', 'ringing')).toBe('ringing');
    expect(() => CallSessionStateMachine.transition('completed', 'ringing')).toThrow();
  });
});

describe('public edge route proof', () => {
  it('blocks internal services and allows web UI APIs by default', () => {
    expect(isPublicEdgePathAllowed('/api/observability/traces')).toBe(false);
    expect(isPublicEdgePathAllowed('/metrics')).toBe(false);
    expect(isPublicEdgePathAllowed('/api/jobs')).toBe(false);
    expect(isPublicEdgePathAllowed('/api/host/status')).toBe(true);
    expect(isPublicEdgePathAllowed('/api/telephony/twilio/inbound')).toBe(true);
    expect(isPublicEdgePathAllowed('/api/chat/stream')).toBe(true);
  });
});

describe('emergency stop ends calls', () => {
  it('emergencyEndAll terminates active sessions', async () => {
    setVoiceCallStore(new VoiceCallStore());
    setTelephonyDialService(null);
    bootstrapTelephonyAdapters({ includeFake: true });
    const store = (await import('@agentx/engine')).getVoiceCallStore();
    const session = await store.saveSession({
      id: 's-em',
      providerId: 'fake',
      providerCallId: 'pc-em',
      direction: 'inbound',
      state: 'active',
      costMinorUnits: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const dial = new TelephonyDialService({ store });
    setTelephonyDialService(dial);
    const ended = await dial.emergencyEndAll('test');
    expect(ended.some((s) => s.id === session.id)).toBe(true);
  });
});

describe('retention job', () => {
  it('runs without error on empty store', async () => {
    setVoiceCallStore(new VoiceCallStore());
    const result = await runVoiceCallRetentionJob({ eventRetentionDays: 1 });
    expect(result.eventsPurged).toBe(0);
  });
});

describe('fake webhook signature still holds', () => {
  it('verifies HMAC', () => {
    bootstrapTelephonyAdapters({ includeFake: true });
    const fake = new FakeTelephonyAdapter();
    const raw = '{"type":"call_started"}';
    const sig = createHmac('sha256', 'tok').update(raw).digest('hex');
    expect(
      fake.verifyWebhook({
        url: 'https://x/test',
        method: 'POST',
        headers: { 'x-agentx-fake-signature': sig },
        rawBody: raw,
        credentials: { authToken: 'tok' },
      }).ok,
    ).toBe(true);
  });
});
