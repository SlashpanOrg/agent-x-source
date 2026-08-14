import { Router, type Request, type Response } from 'express';
import { getLogger, type VoiceCallMission } from '@agentx/shared';
import {
  getTelephonyService,
  getVoiceCallStore,
  getTelephonyDialService,
  TelephonyDialError,
  assertValidVoiceCallMission,
  createDefaultInboundMission,
  redactE164,
} from '@agentx/engine';
import { telephonyWebhookAuth, type TelephonyWebhookLocals } from './middleware/webhook-auth.js';
import { handleInboundCallEvents, handleStatusOrRecordingEvents, handleDtmf } from './inbound-engine.js';
import { metricsRegistry } from '../metrics/MetricsRegistry.js';
import { randomUUID } from 'node:crypto';

/**
 * Management routes (session-authenticated) + webhook routes (signature-authenticated).
 * Provider id is always a path param — adding a vendor never touches this router.
 */
export function createTelephonyRouter(): Router {
  const router = Router();

  router.get('/telephony/providers', (_req, res) => {
    const service = getTelephonyService();
    const catalog = service.getRegistry().listCatalog({
      includeTesting: process.env['NODE_ENV'] === 'test',
    });
    const registered = new Set(service.getRegistry().list().map((a) => a.id));
    res.json({
      providers: catalog.map((entry) => ({
        ...entry,
        adapterRegistered: registered.has(entry.id),
      })),
      activeProviderId: service.getConfig().activeProviderId ?? null,
    });
  });

  router.get('/telephony/providers/:providerId/capabilities', (req, res) => {
    const providerId = String(req.params['providerId']);
    const entry = getTelephonyService().getRegistry().getCatalogEntry(providerId);
    if (!entry) {
      res.status(404).json({ error: 'unknown_provider' });
      return;
    }
    res.json(entry.capabilities);
  });

  router.post('/telephony/providers/:providerId/credentials/test', async (req, res) => {
    try {
      const providerId = String(req.params['providerId']);
      const service = getTelephonyService();
      if (req.body?.credentials && typeof req.body.credentials === 'object') {
        const existing = service.getConfig();
        service.applyConfig({
          providers: {
            ...existing.providers,
            [providerId]: {
              ...existing.providers?.[providerId],
              credentials: {
                ...existing.providers?.[providerId]?.credentials,
                ...req.body.credentials,
              },
            },
          },
        });
      }
      const result = await service.testCredentials(providerId);
      res.json(result);
    } catch (err) {
      res.status(400).json({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/telephony/providers/:providerId/numbers', async (req, res) => {
    const providerId = String(req.params['providerId']);
    const bindings = await getVoiceCallStore().listBindings(providerId);
    res.json({
      numbers: bindings.map((b) => ({
        ...b,
        e164: undefined,
        e164Redacted: b.e164Redacted ?? (b.e164 ? redactE164(b.e164) : null),
      })),
    });
  });

  router.post('/telephony/providers/:providerId/numbers/verify', async (req, res) => {
    try {
      const providerId = String(req.params['providerId']);
      const e164 = String(req.body?.e164 ?? '').trim();
      const providerNumberId = String(req.body?.providerNumberId ?? e164);
      if (!e164 && !providerNumberId) {
        res.status(400).json({ error: 'e164_or_providerNumberId_required' });
        return;
      }
      const binding = await getVoiceCallStore().saveBinding({
        id: String(req.body?.id ?? randomUUID()),
        providerId,
        providerNumberId,
        e164: e164 || null,
        e164Redacted: e164 ? redactE164(e164) : null,
        label: req.body?.label ? String(req.body.label) : null,
        inboundEnabled: req.body?.inboundEnabled !== false,
        outboundEnabled: Boolean(req.body?.outboundEnabled),
      });
      res.json({ ok: true, binding: { ...binding, e164: undefined } });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/telephony/providers/:providerId/webhook/test', async (req, res) => {
    const providerId = String(req.params['providerId']);
    const adapter = getTelephonyService().getRegistry().get(providerId);
    if (!adapter) {
      res.status(404).json({ ok: false, error: 'unknown_provider' });
      return;
    }
    res.json({
      ok: true,
      inboundPath: `/api/telephony/${providerId}/inbound`,
      statusPath: `/api/telephony/${providerId}/status`,
      mediaPath: `/api/telephony/${providerId}/media`,
      signatureRequired: adapter.capabilities.webhookSignatureVerification,
    });
  });

  // ── Missions (runtime/automation interfaces; Host UI is read-only for outcomes) ──
  router.get('/voice/missions', async (req, res) => {
    const status = req.query['status'] ? String(req.query['status']) : undefined;
    const direction = req.query['direction'] ? String(req.query['direction']) : undefined;
    const missions = await getVoiceCallStore().listMissions({
      status: status as VoiceCallMission['status'] | undefined,
      direction: direction as VoiceCallMission['direction'] | undefined,
    });
    res.json({ missions });
  });

  router.post('/voice/missions', async (req, res) => {
    try {
      const body = req.body as Partial<VoiceCallMission>;
      const mission =
        body.direction === 'inbound' && !body.purpose
          ? createDefaultInboundMission(
              String(body.providerId ?? getTelephonyService().getConfig().activeProviderId ?? 'twilio'),
              String(body.phoneNumberId ?? 'default'),
              body,
            )
          : ({
              id: body.id ?? randomUUID(),
              direction: body.direction ?? 'outbound',
              providerId: body.providerId,
              phoneNumberId: body.phoneNumberId,
              recipientE164: body.recipientE164,
              purpose: body.purpose,
              systemContext: body.systemContext,
              allowedActions: body.allowedActions ?? [],
              forbiddenActions: body.forbiddenActions ?? [],
              allowedToolIds: body.allowedToolIds ?? [],
              requireConfirmationFor: body.requireConfirmationFor ?? ['first_recipient'],
              maxDurationSeconds: body.maxDurationSeconds ?? 600,
              maxCostMinorUnits: body.maxCostMinorUnits,
              recording: body.recording ?? 'off',
              aiDisclosure: body.aiDisclosure ?? 'required',
              escalation: body.escalation ?? { onLowConfidence: 'ask_repeat' },
              stopConditions: body.stopConditions ?? [],
              status: body.status ?? 'draft',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            } as VoiceCallMission);
      assertValidVoiceCallMission(mission);
      const saved = await getVoiceCallStore().saveMission(mission);
      res.status(201).json(saved);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/voice/missions/:id', async (req, res) => {
    const mission = await getVoiceCallStore().getMission(String(req.params['id']));
    if (!mission) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(mission);
  });

  router.patch('/voice/missions/:id', async (req, res) => {
    try {
      const existing = await getVoiceCallStore().getMission(String(req.params['id']));
      if (!existing) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const merged = {
        ...existing,
        ...req.body,
        id: existing.id,
        updatedAt: new Date().toISOString(),
      } as VoiceCallMission;
      assertValidVoiceCallMission(merged);
      const saved = await getVoiceCallStore().saveMission(merged);
      res.json(saved);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/voice/missions/:id/arm', async (req, res) => {
    try {
      const existing = await getVoiceCallStore().getMission(String(req.params['id']));
      if (!existing) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const saved = await getVoiceCallStore().saveMission({
        ...existing,
        status: 'armed',
        updatedAt: new Date().toISOString(),
      });
      res.json(saved);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/voice/missions/:id/cancel', async (req, res) => {
    const existing = await getVoiceCallStore().getMission(String(req.params['id']));
    if (!existing) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const saved = await getVoiceCallStore().saveMission({
      ...existing,
      status: 'cancelled',
      updatedAt: new Date().toISOString(),
    });
    res.json(saved);
  });

  router.post('/voice/missions/:id/dial', async (req, res) => {
    try {
      const result = await getTelephonyDialService().dial({
        missionId: String(req.params['id']),
        toE164: req.body?.toE164 ? String(req.body.toE164) : undefined,
        webhookBaseUrl: String(req.body?.webhookBaseUrl ?? ''),
        statusCallbackUrl: req.body?.statusCallbackUrl ? String(req.body.statusCallbackUrl) : undefined,
        approved: Boolean(req.body?.approved),
        requestedBy: req.body?.requestedBy ? String(req.body.requestedBy) : undefined,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof TelephonyDialError) {
        res.status(400).json({ error: err.code, message: err.message });
        return;
      }
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/voice/calls', async (req, res) => {
    const sessions = await getVoiceCallStore().listSessions({
      direction: req.query['direction'] ? (String(req.query['direction']) as 'inbound' | 'outbound') : undefined,
    });
    res.json({
      calls: sessions.map((s) => ({
        id: s.id,
        direction: s.direction,
        state: s.state,
        providerId: s.providerId,
        from: s.fromE164Redacted,
        to: s.toE164Redacted,
        outcome: s.outcome,
        outcomeSummary: s.outcomeSummary,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
      })),
    });
  });

  // ── Webhooks ──
  router.post('/telephony/:providerId/inbound', telephonyWebhookAuth, (req, res) => {
    void handleWebhook(req, res, 'inbound');
  });
  router.post('/telephony/:providerId/status', telephonyWebhookAuth, (req, res) => {
    void handleWebhook(req, res, 'status');
  });
  router.post('/telephony/:providerId/recording', telephonyWebhookAuth, (req, res) => {
    void handleWebhook(req, res, 'recording');
  });

  router.get('/telephony/:providerId/health', (req, res) => {
    const providerId = String(req.params['providerId']);
    const adapter = getTelephonyService().getRegistry().get(providerId);
    if (!adapter) {
      res.status(404).json({ ok: false, error: 'unknown_provider' });
      return;
    }
    res.json({ ok: true, providerId, capabilities: adapter.capabilities });
  });

  return router;
}

async function handleWebhook(req: Request, res: Response, kind: 'inbound' | 'status' | 'recording'): Promise<void> {
  const locals = (res.locals as { telephony?: TelephonyWebhookLocals }).telephony;
  if (!locals) {
    res.status(500).json({ error: 'middleware_missing' });
    return;
  }

  const { adapter, providerId, rawBody } = locals;
  const body =
    typeof req.body === 'string' || Buffer.isBuffer(req.body)
      ? req.body
      : (req.body as Record<string, unknown>);

  const events = adapter.parseWebhook({
    headers: req.headers as Record<string, string | string[] | undefined>,
    body: body as Record<string, unknown> | string,
    rawBody,
  });

  getLogger().info('TELEPHONY_WEBHOOK', `Received ${kind} webhook`, {
    providerId,
    eventCount: events.length,
    types: events.map((e) => e.type),
  });

  // DTMF on status webhooks
  for (const ev of events) {
    if (ev.type === 'dtmf') {
      const digits = String(ev.payload['Digits'] ?? ev.payload['digits'] ?? '');
      if (digits) {
        await handleDtmf({ providerId, providerCallId: ev.providerCallId, digits });
      }
    }
  }

  if (kind === 'inbound') {
    try {
      const result = await handleInboundCallEvents({ providerId, events });
      if (result.rejected) {
        metricsRegistry.incrementCounter('telephony_webhook_total', { kind, status: 'rejected' });
        if (adapter.buildInboundAnswer) {
          const rejectTwiml = adapter.buildInboundAnswer({
            providerCallId: events[0]?.providerCallId ?? 'unknown',
            mediaStreamUrl: result.mediaStreamUrl,
            disclosureText: 'We cannot take your call right now. Goodbye.',
          });
          // Prefer a hangup-style body when rejected — adapters may still return connect;
          // for Twilio send simple Say+Hangup if content is xml.
          if (rejectTwiml.contentType.includes('xml')) {
            res
              .status(200)
              .type('text/xml')
              .send(
                `<?xml version="1.0" encoding="UTF-8"?><Response><Say>We cannot take your call right now. Goodbye.</Say><Hangup/></Response>`,
              );
            return;
          }
        }
        res.status(200).json({ ok: false, rejected: true, reason: result.rejectReason });
        return;
      }

      metricsRegistry.incrementCounter('telephony_webhook_total', { kind, status: 'ok' });
      if (adapter.buildInboundAnswer) {
        const answer = adapter.buildInboundAnswer({
          providerCallId: events[0]?.providerCallId ?? result.session?.providerCallId ?? 'unknown',
          mediaStreamUrl: result.mediaStreamUrl,
          disclosureText: result.disclosureText,
        });
        res.status(200).type(answer.contentType).send(answer.body);
        return;
      }
      res.status(200).json({ ok: true, sessionId: result.session?.id, events });
      return;
    } catch (err) {
      metricsRegistry.incrementCounter('telephony_webhook_total', { kind, status: 'error' });
      getLogger().error('TELEPHONY_INBOUND_FAILED', err);
      res.status(500).json({ error: 'inbound_failed' });
      return;
    }
  }

  try {
    await handleStatusOrRecordingEvents({ providerId, events, kind });
    metricsRegistry.incrementCounter('telephony_webhook_total', { kind, status: 'ok' });
    res.status(200).json({ ok: true, events });
  } catch (err) {
    metricsRegistry.incrementCounter('telephony_webhook_total', { kind, status: 'error' });
    getLogger().error('TELEPHONY_STATUS_FAILED', err);
    res.status(500).json({ error: 'status_failed' });
  }
}
