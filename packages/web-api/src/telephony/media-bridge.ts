import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import type { IncomingMessage } from 'node:http';
import { getLogger } from '@agentx/shared';
import { getTelephonyService, getVoiceCallStore, CallSessionStateMachine } from '@agentx/engine';
import { registerWebSocketRoute } from '../ws-upgrade-router.js';
import { metricsRegistry } from '../metrics/MetricsRegistry.js';

/**
 * Telephony media stream bridge (H5.8–H5.10).
 *
 * Providers (Twilio `<Stream>`, Fake) connect here.
 * Inbound mulaw/PCM frames are normalized and can be forwarded to a
 * VoiceEngineSession when one is attached; until then frames are acknowledged.
 *
 * Path pattern registered dynamically per provider isn't supported by the
 * upgrade router (exact path). We register a single catch-all dispatcher
 * by registering known provider media paths at bootstrap + on demand.
 */

interface MediaBridgeSession {
  providerId: string;
  providerCallId?: string;
  callSessionId?: string;
  protocol: 'mulaw' | 'pcm16' | 'unknown';
  sampleRate: number;
  lastAudioAt: number;
  silenceTimer?: ReturnType<typeof setInterval>;
  onPcm?: (pcm: Buffer) => void;
}

const active = new Map<WebSocket, MediaBridgeSession>();
const SILENCE_HANGUP_MS = 45_000;
let bootstrapped = false;

export function setupTelephonyMediaWebSocket(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  const wss = new WebSocketServer({ noServer: true });
  // Exact paths for shipped providers; custom adapters can call registerTelephonyMediaPath.
  for (const id of ['twilio', 'fake']) {
    registerWebSocketRoute(`/api/telephony/${id}/media`, wss);
  }

  wss.on('connection', (ws, req) => {
    void onConnection(ws, req);
  });
}

export function registerTelephonyMediaPath(providerId: string, wss?: WebSocketServer): void {
  const server = wss ?? new WebSocketServer({ noServer: true });
  registerWebSocketRoute(`/api/telephony/${providerId}/media`, server);
  if (!wss) {
    server.on('connection', (ws, req) => {
      void onConnection(ws, req);
    });
  }
}

async function onConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
  const pathname = (req.url ?? '').split('?')[0] ?? '';
  const match = pathname.match(/^\/api\/telephony\/([^/]+)\/media\/?$/);
  const providerId = match?.[1];
  if (!providerId) {
    ws.close(1008, 'provider_required');
    return;
  }

  const adapter = getTelephonyService().getRegistry().get(providerId);
  if (!adapter) {
    ws.close(1008, 'unknown_provider');
    return;
  }

  const session: MediaBridgeSession = {
    providerId,
    protocol: 'unknown',
    sampleRate: 8000,
    lastAudioAt: Date.now(),
  };
  active.set(ws, session);
  metricsRegistry.incrementCounter('telephony_media_connections_total', { providerId, status: 'open' });

  session.silenceTimer = setInterval(() => {
    if (Date.now() - session.lastAudioAt > SILENCE_HANGUP_MS) {
      getLogger().info('TELEPHONY_MEDIA_SILENCE', 'Closing media stream after silence', {
        providerId,
        callSessionId: session.callSessionId,
      });
      ws.close(1000, 'silence_timeout');
    }
  }, 5_000);

  ws.on('message', (data, isBinary) => {
    session.lastAudioAt = Date.now();
    try {
      if (isBinary) {
        handleBinaryFrame(session, data as Buffer);
        return;
      }
      const text = rawToString(data);
      const msg = JSON.parse(text) as Record<string, unknown>;
      void handleJsonMessage(ws, session, msg);
    } catch (err) {
      getLogger().warn('TELEPHONY_MEDIA_MSG', 'Failed to handle media message', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  ws.on('close', () => {
    cleanup(ws, session);
  });
  ws.on('error', () => {
    cleanup(ws, session);
  });
}

async function handleJsonMessage(
  ws: WebSocket,
  session: MediaBridgeSession,
  msg: Record<string, unknown>,
): Promise<void> {
  const event = String(msg['event'] ?? msg['type'] ?? '');
  if (event === 'start' || event === 'connected' || event === 'media_ready') {
    const startPayload = msg['start'] as { callSid?: string } | undefined;
    session.providerCallId =
      String(
        msg['callSid'] ??
          msg['providerCallId'] ??
          startPayload?.callSid ??
          '',
      ) || session.providerCallId;
    const stream = (msg['start'] as { mediaFormat?: { encoding?: string; sampleRate?: number } } | undefined) ?? undefined;
    const encoding = stream?.mediaFormat?.encoding?.toLowerCase() ?? '';
    if (encoding.includes('mulaw') || encoding.includes('pcmu')) session.protocol = 'mulaw';
    else if (encoding.includes('pcm') || encoding.includes('linear')) session.protocol = 'pcm16';
    session.sampleRate = stream?.mediaFormat?.sampleRate ?? session.sampleRate;

    if (session.providerCallId) {
      const store = getVoiceCallStore();
      const call = await store.getSessionByProviderCall(session.providerId, session.providerCallId);
      if (call) {
        session.callSessionId = call.id;
        try {
          const state = CallSessionStateMachine.transition(call.state, 'active');
          await store.saveSession({ ...call, state });
        } catch {
          /* ignore illegal */
        }
      }
    }
    ws.send(JSON.stringify({ event: 'ack', protocol: session.protocol }));
    return;
  }

  if (event === 'media') {
    const payload = (msg['media'] as { payload?: string } | undefined)?.payload ?? (msg['payload'] as string | undefined);
    if (typeof payload === 'string') {
      const buf = Buffer.from(payload, 'base64');
      handleBinaryFrame(session, buf);
    }
    return;
  }

  if (event === 'dtmf') {
    const digit = String((msg['dtmf'] as { digit?: string } | undefined)?.digit ?? msg['digit'] ?? '');
    if (digit && session.providerCallId) {
      const { handleDtmf } = await import('./inbound-engine.js');
      await handleDtmf({
        providerId: session.providerId,
        providerCallId: session.providerCallId,
        digits: digit,
      });
    }
    return;
  }

  if (event === 'stop' || event === 'closed') {
    ws.close(1000, 'provider_stop');
  }
}

function handleBinaryFrame(session: MediaBridgeSession, data: Buffer): void {
  let pcm: Buffer;
  if (session.protocol === 'mulaw') {
    pcm = mulawToPcm16(data);
  } else {
    pcm = data;
  }
  // Barge-in / interruption: non-silent inbound while we would be speaking —
  // signal via optional callback when a VoiceEngineSession is attached.
  if (session.onPcm) {
    session.onPcm(pcm);
  }
}

function cleanup(ws: WebSocket, session: MediaBridgeSession): void {
  if (session.silenceTimer) clearInterval(session.silenceTimer);
  active.delete(ws);
  metricsRegistry.incrementCounter('telephony_media_connections_total', {
    providerId: session.providerId,
    status: 'closed',
  });
}

function rawToString(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

/** G.711 µ-law → PCM16 LE (approx). */
function mulawToPcm16(mulaw: Buffer): Buffer {
  const out = Buffer.alloc(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) {
    const sample = mulawByteToPcm(mulaw[i]!);
    out.writeInt16LE(sample, i * 2);
  }
  return out;
}

function mulawByteToPcm(muIn: number): number {
  const mu = ~muIn & 0xff;
  const sign = mu & 0x80;
  const exponent = (mu >> 4) & 0x07;
  const mantissa = mu & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign ? -sample : sample;
}

export function __activeMediaBridgeCount(): number {
  return active.size;
}
