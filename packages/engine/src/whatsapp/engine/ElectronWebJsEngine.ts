/**
 * ElectronWebJsEngine — fallback WhatsApp engine adapter for Agent-X.
 *
 * Implements {@link IWhatsAppEngine} against `whatsapp-web.js`'s Puppeteer-based
 * client, attaching to **Electron's own Chromium** via the Chrome DevTools
 * Protocol (CDP) instead of launching a separate browser. This is the key
 * efficiency win validated in the §0.6 spike: zero extra Chromium download,
 * zero extra OS process, minimal extra memory (shares Electron's renderer
 * budget).
 *
 * Auth strategy: `LocalAuth` with a configurable `dataPath` (defaulting to the
 * Electron app's `userData` directory). The plan (§2.4.3) originally aspired to
 * a Postgres-backed `RemoteAuth`, but `whatsapp-web.js`'s `RemoteAuth` still
 * requires a local temp directory for the browser profile (it zips/unzips the
 * Chromium userDataDir) and pulls in `fs-extra`/`unzipper`/`archiver` as
 * optional deps. For a **fallback** engine (Baileys is primary), `LocalAuth` is
 * the simpler, more reliable choice — the session data lives in the app's
 * managed directory and is cleaned up on `unlink`.
 *
 * Single-session scope (Ground Rule 7): exactly one instance is ever active.
 *
 * Written from scratch against the public `whatsapp-web.js` API surface
 * (`Client`, `ClientOptions`, `Events`, `Message`, `MessageAck`) — not copied
 * from any reference project.
 */
import * as WAWebModule from 'whatsapp-web.js';
import type { Message, Client as ClientType } from 'whatsapp-web.js';
import { getLogger } from '@agentx/shared';
import { engineSupportsCapability } from './capability-matrix.js';

const WA = (WAWebModule as any).default ?? (WAWebModule as any);
const { Client, LocalAuth, MessageMedia, Location: WWebLocation, Poll, Events } = WA;

import { toNeutralJid, phoneFromNeutralJid } from '../identity/wa-id.js';
import { mapWWebJsMessage, ackStatusFromWWebJs, mediaFromWWebJs } from './wwebjs-message-mapper.js';
import { EngineStatus } from './IWhatsAppEngine.js';
import type {
  IWhatsAppEngine,
  WhatsAppEngineCallbacks,
  WhatsAppIncomingMessage,
  WhatsAppMessageAck,
  WhatsAppSendResult,
  WhatsAppCallEvent,
  WhatsAppGroupEvent,
  EngineCapability,
} from './IWhatsAppEngine.js';

/** Inbound media download cap (bytes). Larger media is surfaced as `omitted`. */
const DEFAULT_INBOUND_MEDIA_CAP_BYTES = 16 * 1024 * 1024; // 16 MiB

export interface ElectronWebJsEngineOptions {
  /**
   * CDP endpoint URL of Electron's own Chromium, e.g. `http://127.0.0.1:9222`.
   * The caller (Electron main process) must call
   * `app.commandLine.appendSwitch('remote-debugging-port', '<port>')` before
   * `app.whenReady()`.
   */
  cdpEndpoint: string;
  /** Directory for `LocalAuth` session data. Defaults to `./.wwebjs_auth`. */
  dataPath?: string;
  /** Inbound media download cap in bytes. */
  inboundMediaCapBytes?: number;
  /** Device name shown in WhatsApp's linked-devices list. */
  deviceName?: string;
}

/**
 * `whatsapp-web.js`-backed implementation of {@link IWhatsAppEngine}.
 *
 * Lifecycle:
 *   DISCONNECTED → INITIALIZING → (QR_READY | PAIRING) → AUTHENTICATING → READY
 *   any → FAILED on unrecoverable error; any → DISCONNECTED after graceful stop.
 */
export class ElectronWebJsEngine implements IWhatsAppEngine {
  readonly name = 'electron-wwebjs' as const;

  private status: EngineStatus = EngineStatus.DISCONNECTED;
  private callbacks: WhatsAppEngineCallbacks = {};
  private client: ClientType | null = null;
  private currentQr: string | null = null;
  private intentionallyStopped = false;
  private initializing = false;

  private readonly cdpEndpoint: string;
  private readonly dataPath: string | undefined;
  private readonly inboundMediaCapBytes: number;
  private readonly deviceName: string;

  constructor(opts: ElectronWebJsEngineOptions) {
    this.cdpEndpoint = opts.cdpEndpoint;
    this.dataPath = opts.dataPath;
    this.inboundMediaCapBytes = opts.inboundMediaCapBytes ?? DEFAULT_INBOUND_MEDIA_CAP_BYTES;
    this.deviceName = opts.deviceName ?? 'Agent-X';
  }

  // ─── IWhatsAppEngine ────────────────────────────────────────────────────

  setCallbacks(callbacks: WhatsAppEngineCallbacks): void {
    this.callbacks = callbacks;
  }

  async initialize(): Promise<void> {
    if (this.initializing || this.client) return;
    this.initializing = true;
    this.intentionallyStopped = false;
    this.setStatus(EngineStatus.INITIALIZING);

    try {
      const client = new Client({
        puppeteer: {
          browserURL: this.cdpEndpoint,
        },
        authStrategy: new LocalAuth({
          dataPath: this.dataPath,
        }),
        deviceName: this.deviceName,
      });
      this.client = client;
      this.wireEvents();
      // `initialize()` resolves once the client is ready (or throws on auth
      // failure / timeout). QR events fire during initialization.
      await client.initialize();
    } catch (err) {
      this.initializing = false;
      this.setStatus(EngineStatus.FAILED);
      this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
    this.initializing = false;
  }

  async disconnect(): Promise<void> {
    this.intentionallyStopped = true;
    const client = this.client;
    if (!client) {
      this.setStatus(EngineStatus.DISCONNECTED);
      return;
    }
    try {
      await client.destroy();
    } catch {
      // best-effort
    }
    this.client = null;
    this.currentQr = null;
    this.setStatus(EngineStatus.DISCONNECTED);
  }

  async forceDestroy(): Promise<void> {
    this.intentionallyStopped = true;
    const client = this.client;
    if (client) {
      try {
        await client.destroy();
      } catch {
        // ignore — force-kill path
      }
    }
    this.client = null;
    this.currentQr = null;
    this.setStatus(EngineStatus.DISCONNECTED);
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  getQr(): string | null {
    return this.currentQr;
  }

  async requestPairingCode(phoneNumber: string): Promise<string> {
    const client = this.client;
    if (!client) {
      throw new Error('ElectronWebJsEngine: cannot request pairing code before initialize()');
    }
    const normalized = phoneNumber.replace(/[^\d]/g, '');
    this.setStatus(EngineStatus.PAIRING);
    const code = await client.requestPairingCode(normalized);
    this.callbacks.onPairingCode?.(code);
    return code;
  }

  async probeLiveness(): Promise<boolean> {
    const client = this.client;
    if (!client) return false;
    try {
      // `client.info` is populated when the client is ready.
      return !!client.info && this.status === EngineStatus.READY;
    } catch {
      return false;
    }
  }

  supportsCapability(capability: EngineCapability): boolean {
    return engineSupportsCapability(this.name, capability);
  }

  // ─── Messaging ──────────────────────────────────────────────────────────

  async sendText(chatId: string, text: string, opts?: { mentions?: string[]; quotedMessageId?: string }): Promise<WhatsAppSendResult> {
    const client = this.requireClient();
    const msg = await client.sendMessage(chatId, text, {
      mentions: opts?.mentions,
      quotedMessageId: opts?.quotedMessageId,
    });
    return this.toSendResult(msg);
  }

  async sendImage(chatId: string, media: { data: string; mimetype: string; caption?: string }): Promise<WhatsAppSendResult> {
    const client = this.requireClient();
    const mm = new MessageMedia(media.mimetype, media.data);
    const msg = await client.sendMessage(chatId, mm, { caption: media.caption });
    return this.toSendResult(msg);
  }

  async sendVideo(chatId: string, media: { data: string; mimetype: string; caption?: string }): Promise<WhatsAppSendResult> {
    const client = this.requireClient();
    const mm = new MessageMedia(media.mimetype, media.data);
    const msg = await client.sendMessage(chatId, mm, { caption: media.caption, sendVideoAsGif: false });
    return this.toSendResult(msg);
  }

  async sendAudio(chatId: string, media: { data: string; mimetype: string; ptt?: boolean }): Promise<WhatsAppSendResult> {
    const client = this.requireClient();
    const mm = new MessageMedia(media.mimetype, media.data);
    const msg = await client.sendMessage(chatId, mm, { sendAudioAsVoice: media.ptt ?? false });
    return this.toSendResult(msg);
  }

  async sendDocument(chatId: string, media: { data: string; mimetype: string; fileName: string; caption?: string }): Promise<WhatsAppSendResult> {
    const client = this.requireClient();
    const mm = new MessageMedia(media.mimetype, media.data, media.fileName);
    const msg = await client.sendMessage(chatId, mm, { caption: media.caption });
    return this.toSendResult(msg);
  }

  async sendLocation(chatId: string, location: { latitude: number; longitude: number; name?: string; address?: string }): Promise<WhatsAppSendResult> {
    const client = this.requireClient();
    const loc = new WWebLocation(location.latitude, location.longitude, {
      name: location.name,
      address: location.address,
    });
    const msg = await client.sendMessage(chatId, loc);
    return this.toSendResult(msg);
  }

  async sendContact(chatId: string, contact: { displayName: string; phone: string; organization?: string }): Promise<WhatsAppSendResult> {
    const client = this.requireClient();
    const vcard = buildVCard(contact);
    const msg = await client.sendMessage(chatId, vcard, { parseVCards: true });
    return this.toSendResult(msg);
  }

  async sendPoll(chatId: string, question: string, options: string[], opts?: { selectableCount?: number }): Promise<WhatsAppSendResult> {
    const client = this.requireClient();
    const poll = new Poll(question, options, {
      allowMultipleAnswers: (opts?.selectableCount ?? 0) > 1,
      messageSecret: undefined,
    });
    const msg = await client.sendMessage(chatId, poll);
    return this.toSendResult(msg);
  }

  async sendSticker(chatId: string, media: { data: string; mimetype: string }): Promise<WhatsAppSendResult> {
    const client = this.requireClient();
    const mm = new MessageMedia(media.mimetype, media.data);
    const msg = await client.sendMessage(chatId, mm, { sendMediaAsSticker: true });
    return this.toSendResult(msg);
  }

  async reply(chatId: string, quotedMessageId: string, text: string): Promise<WhatsAppSendResult> {
    const client = this.requireClient();
    const msg = await client.sendMessage(chatId, text, { quotedMessageId });
    return this.toSendResult(msg);
  }

  async forwardMessage(chatId: string, _sourceChatId: string, messageId: string): Promise<WhatsAppSendResult> {
    const client = this.requireClient();
    const sourceMsg = await client.getMessageById(messageId);
    if (!sourceMsg) {
      throw new Error(`ElectronWebJsEngine: cannot forward — source message ${messageId} not found`);
    }
    await sourceMsg.forward(chatId);
    // `forward()` doesn't return the new message id; synthesize a result.
    return { messageId: 'forwarded', timestamp: Math.floor(Date.now() / 1000) };
  }

  async react(_chatId: string, messageId: string, emoji: string | null): Promise<void> {
    const client = this.requireClient();
    await client.sendReaction(messageId, emoji ?? '');
  }

  async editMessage(_chatId: string, messageId: string, newText: string): Promise<void> {
    const client = this.requireClient();
    const msg = await client.getMessageById(messageId);
    if (!msg) {
      throw new Error(`ElectronWebJsEngine: cannot edit — message ${messageId} not found`);
    }
    await msg.edit(newText);
  }

  async deleteMessage(_chatId: string, messageId: string, forEveryone: boolean): Promise<void> {
    const client = this.requireClient();
    const msg = await client.getMessageById(messageId);
    if (!msg) {
      throw new Error(`ElectronWebJsEngine: cannot delete — message ${messageId} not found`);
    }
    await msg.delete(forEveryone, true);
  }

  // ─── Contacts / chats ───────────────────────────────────────────────────

  async checkNumberExists(phoneNumber: string): Promise<{ exists: boolean; jid?: string }> {
    const client = this.requireClient();
    const normalized = phoneNumber.replace(/[^\d]/g, '');
    const contactId = await client.getNumberId(normalized);
    if (!contactId) return { exists: false };
    const exists = await client.isRegisteredUser(contactId._serialized);
    return { exists, jid: contactId._serialized };
  }

  async blockContact(jid: string): Promise<void> {
    const client = this.requireClient();
    const contact = await client.getContactById(jid);
    await contact.block();
  }

  async unblockContact(jid: string): Promise<void> {
    const client = this.requireClient();
    const contact = await client.getContactById(jid);
    await contact.unblock();
  }

  // ─── Calls ──────────────────────────────────────────────────────────────

  async rejectCall(callId: string): Promise<void> {
    // `whatsapp-web.js` surfaces calls via the 'call' event with a `Call`
    // object that has a `reject()` method. We don't track call objects here
    // (the callback surface uses a flat `callId`), so the caller should use
    // the `onCallReceived` callback's `callId` to look up the call via the
    // client's event. For now, this is a no-op with a warning — the Baileys
    // engine handles this fully.
    getLogger().warn('WHATSAPP', `ElectronWebJsEngine.rejectCall: call rejection via callId not directly supported by whatsapp-web.js; use the Call object from the 'call' event instead (callId=${callId})`);
  }

  // ─── Internal: event wiring ─────────────────────────────────────────────

  private wireEvents(): void {
    const client = this.client!;

    client.on(Events.QR_RECEIVED, (qr: string) => {
      this.currentQr = qr;
      this.setStatus(EngineStatus.QR_READY);
      // `whatsapp-web.js` gives us the raw QR string; render it to a PNG.
      import('qrcode')
        .then(({ default: QRCode }) => QRCode.toDataURL(qr))
        .then((dataUrl) => this.callbacks.onQRCode?.(dataUrl))
        .catch((err) => {
          getLogger().error('WHATSAPP', err instanceof Error ? err : new Error(String(err)), { ctx: 'wwebjs-qr-render' });
        });
    });

    client.on(Events.AUTHENTICATED, () => {
      this.currentQr = null;
      this.setStatus(EngineStatus.AUTHENTICATING);
    });

    client.on(Events.AUTHENTICATION_FAILURE, (msg: string) => {
      this.setStatus(EngineStatus.FAILED);
      this.callbacks.onError?.(new Error(`whatsapp-web.js auth failure: ${msg}`));
    });

    client.on(Events.READY, () => {
      const info = client.info;
      const phoneNumber = info?.wid?.user ? phoneFromNeutralJid(`${info.wid.user}@c.us`) : undefined;
      const pushName = info?.pushname ?? undefined;
      this.setStatus(EngineStatus.READY, { phoneNumber, pushName });
    });

    client.on(Events.MESSAGE_RECEIVED, (msg: Message) => {
      // Map synchronously first (no media), then download media async and
      // re-emit. This ensures the agent sees the message immediately even if
      // media download is slow or fails.
      const mapped = mapWWebJsMessage(msg);
      if (msg.fromMe) {
        this.callbacks.onMessageSent?.(mapped);
      } else {
        this.callbacks.onMessage?.(mapped);
      }
      // Fire-and-forget media download
      if (msg.hasMedia) {
        this.downloadAndEnrichMedia(msg, mapped).catch(() => {});
      }
    });

    client.on(Events.MESSAGE_CREATE, (msg: Message) => {
      // `message_create` fires for both sent and received; we already handle
      // `message` for the inbound path, so only surface sent messages here
      // that weren't already caught by `message`.
      if (msg.fromMe && msg.type !== 'protocol') {
        this.callbacks.onMessageSent?.(mapWWebJsMessage(msg));
      }
    });

    client.on(Events.MESSAGE_ACK, (msg: Message) => {
      const ack: WhatsAppMessageAck = {
        messageId: msg.id._serialized,
        chatId: msg.fromMe ? msg.to : msg.from,
        status: ackStatusFromWWebJs(msg.ack),
      };
      this.callbacks.onMessageAck?.(ack);
    });

    client.on(Events.MESSAGE_EDIT, (msg: Message) => {
      this.callbacks.onMessageEdited?.(mapWWebJsMessage(msg));
    });

    client.on(Events.MESSAGE_REVOKED_EVERYONE, (msg: Message) => {
      const chatId = msg.fromMe ? msg.to : msg.from;
      this.callbacks.onMessageRevoked?.(chatId, msg.id._serialized);
    });

    client.on(Events.MESSAGE_REACTION, (reaction: { reaction: { senderId: string; msgId: { _serialized: string }; reaction: string } }) => {
      const r = reaction.reaction;
      // The msgId._serialized encodes the chat; extract chatId from it.
      // wwebjs _serialized format: "<msgId>@<chatId>" or falsey if not available.
      const chatId = r.msgId._serialized?.split('@')[1] ? `${r.msgId._serialized.split('@')[1]}` : '';
      this.callbacks.onMessageReaction?.(
        chatId,
        r.msgId._serialized,
        r.senderId,
        r.reaction || null,
      );
    });

    client.on(Events.GROUP_JOIN, (notification: { id: string; type: string; recipientIds: string[]; author: string }) => {
      this.emitGroupEvent(notification, 'add');
    });
    client.on(Events.GROUP_LEAVE, (notification: { id: string; type: string; recipientIds: string[]; author: string }) => {
      this.emitGroupEvent(notification, 'remove');
    });
    client.on(Events.GROUP_ADMIN_CHANGED, (notification: { id: string; type: string; recipientIds: string[]; author: string }) => {
      // `group_admin_changed` doesn't directly map to promote/demote; we infer
      // from the notification type sub-field if available.
      const action = notification.type === 'promote' ? 'promote' : 'demote';
      this.emitGroupEvent(notification, action as 'promote' | 'demote');
    });

    client.on(Events.CALL, (call: { id: string; from?: string; isVideo: boolean; timestamp: number; fromMe: boolean }) => {
      if (!call.fromMe) {
        const ev: WhatsAppCallEvent = {
          callId: call.id,
          from: call.from ?? '',
          isVideo: call.isVideo,
          timestamp: call.timestamp,
        };
        this.callbacks.onCallReceived?.(ev);
      }
    });

    client.on(Events.DISCONNECTED, () => {
      if (!this.intentionallyStopped) {
        this.callbacks.onDisconnected?.('whatsapp-web.js client disconnected');
      }
      this.setStatus(EngineStatus.DISCONNECTED);
    });
  }

  private emitGroupEvent(notification: { id: string; recipientIds: string[]; author: string }, action: 'add' | 'remove' | 'promote' | 'demote'): void {
    const ev: WhatsAppGroupEvent = {
      groupId: toNeutralJid(notification.id),
      author: notification.author ? toNeutralJid(notification.author) : '',
      participants: notification.recipientIds.map((id) => toNeutralJid(id)),
      action,
    };
    this.callbacks.onGroupEvent?.(ev);
  }

  // ─── Internal: message mapping with media ───────────────────────────────

  /**
   * Download media for a message and re-emit the enriched message through the
   * appropriate callback. Called fire-and-forget from the message event handler
   * so the agent sees the message body immediately, then gets the media once
   * the download completes.
   */
  private async downloadAndEnrichMedia(msg: Message, base: WhatsAppIncomingMessage): Promise<void> {
    try {
      const media = await msg.downloadMedia();
      if (media) {
        base.media = mediaFromWWebJs(media, this.inboundMediaCapBytes);
      }
    } catch (err) {
      getLogger().warn('WHATSAPP', `wwebjs media download failed: ${err instanceof Error ? err.message : String(err)}`);
      base.media = { mimetype: 'application/octet-stream', omitted: true };
    }
    // Re-emit with media attached
    if (msg.fromMe) {
      this.callbacks.onMessageSent?.(base);
    } else {
      this.callbacks.onMessage?.(base);
    }
  }

  // ─── Internal: helpers ──────────────────────────────────────────────────

  private requireClient(): ClientType {
    if (!this.client) {
      throw new Error('ElectronWebJsEngine: client not initialized — call initialize() first');
    }
    return this.client;
  }

  private setStatus(status: EngineStatus, info?: { phoneNumber?: string; pushName?: string }): void {
    this.status = status;
    this.callbacks.onStateChanged?.(status, info);
  }

  private toSendResult(msg: Message): WhatsAppSendResult {
    return {
      messageId: msg.id._serialized,
      timestamp: msg.timestamp ?? Math.floor(Date.now() / 1000),
    };
  }
}

// ─── Module-private helpers ──────────────────────────────────────────────

/** Build a minimal vCard 3.0 string for `sendContact`. */
function buildVCard(contact: { displayName: string; phone: string; organization?: string }): string {
  const org = contact.organization ? `ORG:${contact.organization}\n` : '';
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${contact.displayName}`,
    `TEL;type=CELL;waid=${contact.phone.replace(/[^\d]/g, '')}:${contact.phone}`,
    org,
    'END:VCARD',
  ].filter(Boolean).join('\n');
}
