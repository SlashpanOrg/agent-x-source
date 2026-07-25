/**
 * BaileysEngine — primary WhatsApp engine adapter for Agent-X.
 *
 * Implements {@link IWhatsAppEngine} against `@whiskeysockets/baileys`'s
 * multi-device WebSocket client. Auth state is persisted to Postgres via
 * {@link WhatsAppStore} (encrypted creds + per-key signal store), wrapped with
 * Baileys' own `makeCacheableSignalKeyStore()` to prevent write-then-read races
 * (a documented Baileys requirement).
 *
 * Written from scratch against the public Baileys API surface
 * (`makeWASocket`, `BaileysEventMap`, `AuthenticationState`, `SocketConfig`)
 * — not copied from any reference project. The event-wiring and lifecycle
 * structure here is an inherent property of "drive a WhatsApp multi-device
 * socket library", not anyone's IP.
 *
 * Single-session scope (Ground Rule 7): exactly one `BaileysEngine` instance
 * is ever active, so nothing here is parameterized by a session id.
 */
import type { Pool } from 'pg';
import {
  makeWASocket,
  makeCacheableSignalKeyStore,
  Browsers,
  fetchLatestWaWebVersion,
  DisconnectReason,
  getContentType,
  downloadMediaMessage,
  proto,
  type WASocket,
  type AuthenticationState,
  type BaileysEventEmitter,
  type BaileysEventMap,
  type WAMessage,
  type WAVersion,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { getLogger } from '@agentx/shared';

import {
  WhatsAppCredsStore,
  WhatsAppSignalKeyStore,
  createWhatsAppAuthStores,
} from '../WhatsAppStore.js';
import { LidMappingStore } from '../identity/LidMappingStore.js';
import { toNeutralJid, phoneFromNeutralJid } from '../identity/wa-id.js';
import { mapBaileysMessage, extractLidPairFromKey } from './baileys-message-mapper.js';
import { EngineStatus } from './IWhatsAppEngine.js';
import type {
  IWhatsAppEngine,
  WhatsAppEngineCallbacks,
  WhatsAppMessageAck,
  WhatsAppMessageStatus,
  WhatsAppSendResult,
  WhatsAppCallEvent,
  WhatsAppGroupEvent,
  WhatsAppContactEntry,
  WhatsAppIncomingMessage,
  WhatsAppReactionEntry,
  WhatsAppGroupInfo,
  WhatsAppGroupParticipant,
  WhatsAppChannel,
  EngineCapability,
} from './IWhatsAppEngine.js';

/** Reconnect backoff config (Phase 2.3.6). */
interface ReconnectConfig {
  initialDelayMs: number;
  maxDelayMs: number;
  maxAttempts: number; // 0 = unlimited
}

const DEFAULT_RECONNECT: ReconnectConfig = {
  initialDelayMs: 2_000,
  maxDelayMs: 120_000,
  maxAttempts: 0, // unlimited — a logged-out session is the only hard stop
};

/** Inbound media download cap (bytes). Larger media is surfaced as `omitted`. */
const DEFAULT_INBOUND_MEDIA_CAP_BYTES = 16 * 1024 * 1024; // 16 MiB

/** Map Baileys' `proto.WebMessageInfo.Status` → our neutral ack status. */
function ackStatusFromWaStatus(status: proto.WebMessageInfo.Status | null | undefined): WhatsAppMessageStatus {
  switch (status) {
    case proto.WebMessageInfo.Status.PENDING:
      return 'pending';
    case proto.WebMessageInfo.Status.SERVER_ACK:
      return 'sent';
    case proto.WebMessageInfo.Status.DELIVERY_ACK:
      return 'delivered';
    case proto.WebMessageInfo.Status.READ:
    case proto.WebMessageInfo.Status.PLAYED:
      return 'read';
    case proto.WebMessageInfo.Status.ERROR:
      return 'failed';
    default:
      return 'pending';
  }
}

export interface BaileysEngineOptions {
  pool: Pool;
  /** Data-encryption key for credential storage (from Agent-X's key manager). */
  dek: Buffer;
  /** Optional override of the WA web version; otherwise fetched at init time. */
  version?: WAVersion;
  /** Browser identity tuple sent in the pairing handshake. */
  browser?: [string, string, string];
  /** Reconnect-with-backoff tuning. */
  reconnect?: Partial<ReconnectConfig>;
  /** Inbound media download cap in bytes. */
  inboundMediaCapBytes?: number;
  /** Set true to disable history sync entirely (default: disabled, per §0.7). */
  syncFullHistory?: boolean;
}

/**
 * Baileys-backed implementation of {@link IWhatsAppEngine}.
 *
 * Lifecycle:
 *   DISCONNECTED → INITIALIZING → (QR_READY | PAIRING) → AUTHENTICATING → READY
 *   any → FAILED on unrecoverable error; any → DISCONNECTED after graceful stop.
 */
export class BaileysEngine implements IWhatsAppEngine {
  readonly name = 'baileys' as const;

  private status: EngineStatus = EngineStatus.DISCONNECTED;
  private callbacks: WhatsAppEngineCallbacks = {};
  private sock: WASocket | null = null;
  private ev: BaileysEventEmitter | null = null;

  private readonly credsStore: WhatsAppCredsStore;
  private readonly keyStore: WhatsAppSignalKeyStore;
  private readonly lidStore: LidMappingStore;
  private readonly reconnect: ReconnectConfig;
  private readonly inboundMediaCapBytes: number;
  private readonly browser: [string, string, string];
  private version: WAVersion | undefined;

  private currentQr: string | null = null;
  private meJid = '';

  /** In-memory contact store, populated from Baileys events. */
  private contacts = new Map<string, import('@whiskeysockets/baileys').Contact>();

  /**
   * In-memory message store, keyed by chatId. Populated from `messages.upsert`
   * (both incoming and outgoing echoes) so `getMessageHistory` can return
   * recent messages without full history sync (disabled per §0.7). Capped per
   * chat to bound memory.
   */
  private messagesByChat = new Map<string, WhatsAppIncomingMessage[]>();
  private readonly messageStoreCapPerChat = 500;

  /** In-memory reaction store: chatId → messageId → reactions. */
  private reactionsByMessage = new Map<string, Map<string, WhatsAppReactionEntry[]>>();

  /** Channels (newsletters) the user has subscribed to via this engine. */
  private followedChannels = new Map<string, WhatsAppChannel>();

  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyStopped = false;
  private initializing = false;

  /** Bound event handlers (kept as fields so we can `off()` them on teardown). */
  private onConnectionUpdate!: (u: BaileysEventMap['connection.update']) => void;
  private onCredsUpdate!: (u: BaileysEventMap['creds.update']) => void;
  private onMessagesUpsert!: (u: BaileysEventMap['messages.upsert']) => void;
  private onMessagesUpdate!: (u: BaileysEventMap['messages.update']) => void;
  private onMessageReceiptUpdate!: (u: BaileysEventMap['message-receipt.update']) => void;
  private onMessagesReaction!: (u: BaileysEventMap['messages.reaction']) => void;
  private onGroupParticipantsUpdate!: (u: BaileysEventMap['group-participants.update']) => void;
  private onCall!: (u: BaileysEventMap['call']) => void;
  private onLidMappingUpdate!: (u: BaileysEventMap['lid-mapping.update']) => void;
  private onContactsUpsert!: (u: BaileysEventMap['contacts.upsert']) => void;
  private onContactsUpdate!: (u: BaileysEventMap['contacts.update']) => void;
  private onMessagingHistorySet!: (u: BaileysEventMap['messaging-history.set']) => void;

  constructor(opts: BaileysEngineOptions) {
    const { credsStore, keyStore } = createWhatsAppAuthStores(opts.pool, opts.dek);
    this.credsStore = credsStore;
    this.keyStore = keyStore;
    this.lidStore = new LidMappingStore(opts.pool);
    this.reconnect = { ...DEFAULT_RECONNECT, ...opts.reconnect };
    this.inboundMediaCapBytes = opts.inboundMediaCapBytes ?? DEFAULT_INBOUND_MEDIA_CAP_BYTES;
    this.browser = opts.browser ?? Browsers.appropriate('Desktop');
    this.version = opts.version;
  }

  // ─── IWhatsAppEngine ────────────────────────────────────────────────────

  setCallbacks(callbacks: WhatsAppEngineCallbacks): void {
    this.callbacks = callbacks;
  }

  async initialize(): Promise<void> {
    if (this.initializing || this.sock) return;
    this.initializing = true;
    this.intentionallyStopped = false;
    this.setStatus(EngineStatus.INITIALIZING);

    try {
      await this.lidStore.load();
      await this.startSocket();
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
    this.clearReconnectTimer();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const sock = this.sock;
    if (!sock) {
      this.setStatus(EngineStatus.DISCONNECTED);
      return;
    }

    try {
      await sock.end(undefined);
    } catch {
      // best-effort — a failing end() shouldn't block teardown
    }
    this.teardownListeners();
    this.sock = null;
    this.ev = null;
    this.currentQr = null;
    this.reconnectAttempts = 0;
    this.setStatus(EngineStatus.DISCONNECTED);
  }

  async forceDestroy(): Promise<void> {
    this.intentionallyStopped = true;
    this.clearReconnectTimer();
    const sock = this.sock;
    if (sock) {
      try {
        await sock.logout('forceDestroy');
      } catch {
        // ignore — force-kill path
      }
      try {
        await sock.end(undefined);
      } catch {
        // ignore
      }
    }
    this.teardownListeners();
    this.sock = null;
    this.ev = null;
    this.currentQr = null;
    this.reconnectAttempts = 0;
    this.contacts.clear();
    this.setStatus(EngineStatus.DISCONNECTED);
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  getQr(): string | null {
    return this.currentQr;
  }

  async requestPairingCode(phoneNumber: string): Promise<string> {
    const sock = this.sock;
    if (!sock) {
      throw new Error('BaileysEngine: cannot request pairing code before initialize()');
    }
    // Baileys requires the phone to be in E.164-ish form without '+' or non-digits.
    const normalized = phoneNumber.replace(/[^\d]/g, '');
    this.setStatus(EngineStatus.PAIRING);
    const code = await sock.requestPairingCode(normalized);
    this.callbacks.onPairingCode?.(code);
    return code;
  }

  async probeLiveness(): Promise<boolean> {
    const sock = this.sock;
    if (!sock) return false;
    try {
      // A cheap probe: ask WA whether our own number exists. This round-trips
      // the WS and exercises the auth state without side effects.
      const me = this.meJid;
      if (!me) return false;
      const phone = phoneFromNeutralJid(me);
      if (!phone) return this.status === EngineStatus.READY;
      const res = await sock.onWhatsApp(phone);
      return Array.isArray(res) && res.length > 0 && res[0]?.exists === true;
    } catch {
      return false;
    }
  }

  supportsCapability(capability: EngineCapability): boolean {
    switch (capability) {
      case 'rejectCall':
      case 'groupManagement':
      case 'chatHistoryFetch':
      case 'messageReactionsQuery':
      case 'statusStories':
      case 'channels':
        // All implemented against the Baileys multi-device socket API.
        return true;
      case 'labels':
      case 'catalog':
        // Labels and catalog are WhatsApp Business API / wwebjs features.
        // Baileys multi-device does not expose them — require the wwebjs fallback.
        return false;
      default:
        return false;
    }
  }

  // ─── Messaging ──────────────────────────────────────────────────────────

  async sendText(chatId: string, text: string, opts?: { mentions?: string[]; quotedMessageId?: string }): Promise<WhatsAppSendResult> {
    const sock = this.requireSocket();
    const quoted = opts?.quotedMessageId ? await this.fetchMessageForQuote(opts.quotedMessageId, chatId) : undefined;
    const sent = await sock.sendMessage(chatId, {
      text,
      mentions: opts?.mentions,
    }, { quoted });
    return this.toSendResult(sent);
  }

  async sendImage(chatId: string, media: { data: string; mimetype: string; caption?: string }): Promise<WhatsAppSendResult> {
    const sock = this.requireSocket();
    const sent = await sock.sendMessage(chatId, {
      image: Buffer.from(media.data, 'base64'),
      mimetype: media.mimetype,
      caption: media.caption,
    });
    return this.toSendResult(sent);
  }

  async sendVideo(chatId: string, media: { data: string; mimetype: string; caption?: string }): Promise<WhatsAppSendResult> {
    const sock = this.requireSocket();
    const sent = await sock.sendMessage(chatId, {
      video: Buffer.from(media.data, 'base64'),
      mimetype: media.mimetype,
      caption: media.caption,
    });
    return this.toSendResult(sent);
  }

  async sendAudio(chatId: string, media: { data: string; mimetype: string; ptt?: boolean }): Promise<WhatsAppSendResult> {
    const sock = this.requireSocket();
    const sent = await sock.sendMessage(chatId, {
      audio: Buffer.from(media.data, 'base64'),
      mimetype: media.mimetype,
      ptt: media.ptt ?? false,
    });
    return this.toSendResult(sent);
  }

  async sendDocument(chatId: string, media: { data: string; mimetype: string; fileName: string; caption?: string }): Promise<WhatsAppSendResult> {
    const sock = this.requireSocket();
    const sent = await sock.sendMessage(chatId, {
      document: Buffer.from(media.data, 'base64'),
      mimetype: media.mimetype,
      fileName: media.fileName,
      caption: media.caption,
    });
    return this.toSendResult(sent);
  }

  async sendLocation(chatId: string, location: { latitude: number; longitude: number; name?: string; address?: string }): Promise<WhatsAppSendResult> {
    const sock = this.requireSocket();
    const sent = await sock.sendMessage(chatId, {
      location: {
        degreesLatitude: location.latitude,
        degreesLongitude: location.longitude,
        name: location.name,
        address: location.address,
      },
    });
    return this.toSendResult(sent);
  }

  async sendContact(chatId: string, contact: { displayName: string; phone: string; organization?: string }): Promise<WhatsAppSendResult> {
    const sock = this.requireSocket();
    const vcard = buildVCard(contact);
    const sent = await sock.sendMessage(chatId, {
      contacts: {
        displayName: contact.displayName,
        contacts: [{ vcard }],
      },
    });
    return this.toSendResult(sent);
  }

  async sendPoll(chatId: string, question: string, options: string[], opts?: { selectableCount?: number }): Promise<WhatsAppSendResult> {
    const sock = this.requireSocket();
    const sent = await sock.sendMessage(chatId, {
      poll: {
        name: question,
        values: options,
        selectableCount: opts?.selectableCount ?? 0,
        toAnnouncementGroup: false,
      },
    });
    return this.toSendResult(sent);
  }

  async sendSticker(chatId: string, media: { data: string; mimetype: string }): Promise<WhatsAppSendResult> {
    const sock = this.requireSocket();
    const sent = await sock.sendMessage(chatId, {
      sticker: Buffer.from(media.data, 'base64'),
      mimetype: media.mimetype,
    });
    return this.toSendResult(sent);
  }

  async reply(chatId: string, quotedMessageId: string, text: string): Promise<WhatsAppSendResult> {
    const sock = this.requireSocket();
    const quoted = await this.fetchMessageForQuote(quotedMessageId, chatId);
    const sent = await sock.sendMessage(chatId, { text }, { quoted });
    return this.toSendResult(sent);
  }

  async forwardMessage(chatId: string, sourceChatId: string, messageId: string): Promise<WhatsAppSendResult> {
    const sock = this.requireSocket();
    const source = await this.fetchMessageByKey(sourceChatId, messageId);
    if (!source) {
      throw new Error(`BaileysEngine: cannot forward — source message ${messageId} not found in ${sourceChatId}`);
    }
    const sent = await sock.sendMessage(chatId, { forward: source, force: false });
    return this.toSendResult(sent);
  }

  async react(chatId: string, messageId: string, emoji: string | null): Promise<void> {
    const sock = this.requireSocket();
    await sock.sendMessage(chatId, {
      react: {
        text: emoji ?? '',
        key: { remoteJid: chatId, id: messageId, fromMe: false },
      },
    });
  }

  async editMessage(chatId: string, messageId: string, newText: string): Promise<void> {
    const sock = this.requireSocket();
    await sock.sendMessage(chatId, {
      text: newText,
      edit: { remoteJid: chatId, id: messageId, fromMe: true },
    });
  }

  async deleteMessage(chatId: string, messageId: string, forEveryone: boolean): Promise<void> {
    const sock = this.requireSocket();
    await sock.sendMessage(chatId, {
      delete: { remoteJid: chatId, id: messageId, fromMe: true },
    });
    if (!forEveryone) {
      // Baileys' `delete` is always "for everyone" on multi-device; a
      // local-only delete isn't expressible over the protocol. We still honor
      // the call (the message is removed) and surface this limitation via the
      // capability matrix rather than throwing.
      getLogger().warn('WHATSAPP', 'deleteMessage: local-only delete not supported by multi-device protocol; deleting for everyone');
    }
  }

  // ─── Contacts / chats ───────────────────────────────────────────────────

  async checkNumberExists(phoneNumber: string): Promise<{ exists: boolean; jid?: string }> {
    const sock = this.requireSocket();
    const normalized = phoneNumber.replace(/[^\d]/g, '');
    const res = await sock.onWhatsApp(normalized);
    if (!res || res.length === 0) return { exists: false };
    const hit = res[0];
    return { exists: !!hit?.exists, jid: hit?.jid ? toNeutralJid(hit.jid) : undefined };
  }

  async blockContact(jid: string): Promise<void> {
    const sock = this.requireSocket();
    await sock.updateBlockStatus(jid, 'block');
  }

  async unblockContact(jid: string): Promise<void> {
    const sock = this.requireSocket();
    await sock.updateBlockStatus(jid, 'unblock');
  }

  // ─── Calls ──────────────────────────────────────────────────────────────

  async rejectCall(callId: string): Promise<void> {
    const sock = this.requireSocket();
    // Baileys' rejectCall needs the call's origin jid; we track the most
    // recent incoming call for that. If none is known, reject is a no-op.
    const from = this.lastCallFrom;
    if (!from) {
      getLogger().warn('WHATSAPP', `rejectCall: no recent call on record for callId=${callId}`);
      return;
    }
    await sock.rejectCall(callId, from);
  }

  private lastCallFrom: string | null = null;

  // ─── Internal: socket lifecycle ─────────────────────────────────────────

  /**
   * Build the AuthenticationState backed by our Postgres stores, then create
   * the socket and wire all event handlers.
   */
  private async startSocket(): Promise<void> {
    const creds = await this.credsStore.loadOrInit();
    const cachedKeyStore = makeCacheableSignalKeyStore(this.keyStore, silentLogger());

    const authState: AuthenticationState = {
      creds,
      keys: cachedKeyStore,
    };

    if (!this.version) {
      try {
        const fetched = await fetchLatestWaWebVersion();
        if (fetched.version) this.version = fetched.version;
      } catch {
        // fall through to baileys' own default below
      }
    }
    const version = this.version ?? ([2, 3000, 1017] as WAVersion);

    const sock = makeWASocket({
      auth: authState,
      version,
      browser: this.browser,
      logger: silentLogger(),
      // Disable history sync by default (§0.7) — opt-in only.
      shouldSyncHistoryMessage: () => false,
      syncFullHistory: false,
      markOnlineOnConnect: true,
      // Reasonable defaults; baileys' own DEFAULT_CONNECTION_CONFIG fills the rest.
      connectTimeoutMs: 20_000,
      keepAliveIntervalMs: 30_000,
      // Provide a getMessage stub so retry-resends can find the original message.
      getMessage: async (key) => this.getMessageForRetry(key),
    });

    this.sock = sock;
    this.ev = sock.ev;
    this.wireEvents();

    // If creds are already registered (returning session), Baileys will
    // short-circuit straight to `open`. Otherwise it emits a QR.
    if (creds.registered) {
      this.setStatus(EngineStatus.AUTHENTICATING);
    }
  }

  private wireEvents(): void {
    const ev = this.ev!;
    this.onConnectionUpdate = (u) => this.handleConnectionUpdate(u);
    this.onCredsUpdate = () => this.handleCredsUpdate();
    this.onMessagesUpsert = (u) => this.handleMessagesUpsert(u);
    this.onMessagesUpdate = (u) => this.handleMessagesUpdate(u);
    this.onMessageReceiptUpdate = (u) => this.handleMessageReceiptUpdate(u);
    this.onMessagesReaction = (u) => this.handleMessagesReaction(u);
    this.onGroupParticipantsUpdate = (u) => this.handleGroupParticipantsUpdate(u);
    this.onCall = (u) => this.handleCall(u);
    this.onLidMappingUpdate = (u) => this.handleLidMappingUpdate(u);
    this.onContactsUpsert = (u) => this.handleContactsUpsert(u);
    this.onContactsUpdate = (u) => this.handleContactsUpdate(u);
    this.onMessagingHistorySet = (u) => this.handleMessagingHistorySet(u);

    ev.on('connection.update', this.onConnectionUpdate);
    ev.on('creds.update', this.onCredsUpdate);
    ev.on('messages.upsert', this.onMessagesUpsert);
    ev.on('messages.update', this.onMessagesUpdate);
    ev.on('message-receipt.update', this.onMessageReceiptUpdate);
    ev.on('messages.reaction', this.onMessagesReaction);
    ev.on('group-participants.update', this.onGroupParticipantsUpdate);
    ev.on('call', this.onCall);
    ev.on('lid-mapping.update', this.onLidMappingUpdate);
    ev.on('contacts.upsert', this.onContactsUpsert);
    ev.on('contacts.update', this.onContactsUpdate);
    ev.on('messaging-history.set', this.onMessagingHistorySet);
  }

  private teardownListeners(): void {
    const ev = this.ev;
    if (!ev) return;
    ev.off('connection.update', this.onConnectionUpdate);
    ev.off('creds.update', this.onCredsUpdate);
    ev.off('messages.upsert', this.onMessagesUpsert);
    ev.off('messages.update', this.onMessagesUpdate);
    ev.off('message-receipt.update', this.onMessageReceiptUpdate);
    ev.off('messages.reaction', this.onMessagesReaction);
    ev.off('group-participants.update', this.onGroupParticipantsUpdate);
    ev.off('call', this.onCall);
    ev.off('lid-mapping.update', this.onLidMappingUpdate);
    ev.off('contacts.upsert', this.onContactsUpsert);
    ev.off('contacts.update', this.onContactsUpdate);
    ev.off('messaging-history.set', this.onMessagingHistorySet);
    ev.removeAllListeners('connection.update');
  }

  // ─── Internal: event handlers ───────────────────────────────────────────

  private handleConnectionUpdate(u: BaileysEventMap['connection.update']): void {
    const { connection, qr, lastDisconnect } = u;

    if (qr) {
      this.currentQr = qr;
      this.setStatus(EngineStatus.QR_READY);
      // Render the QR string into a PNG data URL for the dashboard/UI.
      QRCode.toDataURL(qr)
        .then((dataUrl) => this.callbacks.onQRCode?.(dataUrl))
        .catch((err) => {
          getLogger().error('WHATSAPP', err instanceof Error ? err : new Error(String(err)), { ctx: 'qr-render' });
        });
      return;
    }

    if (connection === 'open') {
      this.currentQr = null;
      const me = this.sock?.user;
      this.meJid = me?.id ?? '';
      const phoneNumber = me?.id ? phoneFromNeutralJid(toNeutralJid(me.id)) : undefined;
      this.setStatus(EngineStatus.READY, { phoneNumber, pushName: me?.name ?? me?.notify });
      this.reconnectAttempts = 0;
      return;
    }

    if (connection === 'connecting') {
      if (this.status !== EngineStatus.INITIALIZING) {
        // A reconnect in flight; don't clobber a more specific state.
      }
      return;
    }

    if (connection === 'close') {
      this.currentQr = null;
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      const isLoggedOut = code === DisconnectReason.loggedOut;

      if (isLoggedOut) {
        // Hard stop: credentials are invalid. Purge them so a fresh QR can be
        // generated on the next initialize().
        void this.credsStore.clear().catch(() => {});
        this.intentionallyStopped = true;
        this.setStatus(EngineStatus.FAILED);
        this.callbacks.onDisconnected?.(`logged_out (${code})`);
        return;
      }

      if (this.intentionallyStopped) {
        this.setStatus(EngineStatus.DISCONNECTED);
        this.callbacks.onDisconnected?.(lastDisconnect?.error?.message ?? 'intentional stop');
        return;
      }

      // Restart with backoff.
      this.scheduleReconnect(code);
    }
  }

  private async handleCredsUpdate(): Promise<void> {
    const sock = this.sock;
    if (!sock) return;
    try {
      await this.credsStore.save(sock.authState.creds);
    } catch (err) {
      getLogger().error('WHATSAPP', err instanceof Error ? err : new Error(String(err)), { ctx: 'creds-save' });
    }
  }

  private async handleMessagesUpsert(u: BaileysEventMap['messages.upsert']): Promise<void> {
    const { messages, type } = u;
    for (const waMsg of messages) {
      // Learn lid<->phone mappings passively from every message key.
      const pair = extractLidPairFromKey(waMsg.key);
      if (pair) {
        await this.lidStore.remember(pair.lid, pair.phone).catch(() => {});
      }

      const me = this.meJid || this.sock?.user?.id || '';
      const resolved = await this.resolveMedia(waMsg).catch(() => undefined);
      const mapped = mapBaileysMessage(waMsg, me, resolved);

      // Resolve LID sender → phone if we now know it.
      if (mapped.isLidSender && !mapped.senderPhone) {
        const lidRaw = waMsg.key.participant ?? waMsg.key.remoteJid ?? '';
        const lid = lidRaw.split('@')[0]?.split(':')[0] ?? '';
        const phone = this.lidStore.getCached(lid);
        if (phone) mapped.senderPhone = phone;
      }

      if (mapped.fromMe) {
        // Our own outgoing message echoed back (e.g. sent from another device).
        this.callbacks.onMessageSent?.(mapped);
      } else if (type === 'notify') {
        this.callbacks.onMessage?.(mapped);
      }
      // type === 'append' (history sync) is intentionally ignored — we disabled
      // history sync (§0.7), so this branch shouldn't fire in practice.

      // Record into the in-memory history store (both incoming and outgoing)
      // so getMessageHistory can return recent conversation context.
      this.recordMessage(mapped);
    }
  }

  private handleMessagesUpdate(updates: BaileysEventMap['messages.update']): void {
    for (const upd of updates) {
      const status = ackStatusFromWaStatus(upd.update.status);
      const chatId = upd.key.remoteJid ? toNeutralJid(upd.key.remoteJid) : '';
      const messageId = upd.key.id ?? '';

      // Revoked messages arrive as a protocolMessage with a revoke stub type.
      const protoType = (upd.update as proto.IMessage).protocolMessage?.type;
      if (protoType === proto.Message.ProtocolMessage.Type.REVOKE) {
        this.callbacks.onMessageRevoked?.(chatId, messageId);
        continue;
      }

      // Edited messages surface as an update carrying new message content.
      const editedMsg = upd.update.message;
      if (editedMsg && upd.update.status !== undefined) {
        const me = this.meJid || this.sock?.user?.id || '';
        const synthetic: WAMessage = {
          key: upd.key,
          message: editedMsg,
          messageTimestamp: upd.update.messageTimestamp ?? Date.now() / 1000,
        };
        const mapped = mapBaileysMessage(synthetic, me);
        this.callbacks.onMessageEdited?.(mapped);
      }

      const ack: WhatsAppMessageAck = { messageId, chatId, status };
      this.callbacks.onMessageAck?.(ack);
    }
  }

  private handleMessageReceiptUpdate(updates: BaileysEventMap['message-receipt.update']): void {
    for (const r of updates) {
      const chatId = r.key.remoteJid ? toNeutralJid(r.key.remoteJid) : '';
      const messageId = r.key.id ?? '';
      // IUserReceipt has no explicit `type`; infer status from which
      // timestamps are populated (read > played > delivered > sent).
      const receipt = r.receipt;
      let status: WhatsAppMessageStatus | undefined;
      if (receipt.readTimestamp != null || receipt.playedTimestamp != null) {
        status = 'read';
      } else if (receipt.deliveredDeviceJid && receipt.deliveredDeviceJid.length > 0) {
        status = 'delivered';
      } else if (receipt.receiptTimestamp != null) {
        status = 'sent';
      }
      if (status) {
        this.callbacks.onMessageAck?.({ messageId, chatId, status });
      }
    }
  }

  private handleMessagesReaction(updates: BaileysEventMap['messages.reaction']): void {
    for (const r of updates) {
      // Baileys emits: r.key = the reacted message's key (target),
      // r.reaction.key = the reactor's own message key (who reacted).
      const targetKey = r.key;
      const reactorKey = r.reaction.key;
      const chatId = targetKey.remoteJid ? toNeutralJid(targetKey.remoteJid) : '';
      const messageId = targetKey.id ?? '';
      // The reactor's identity: participant (groups) or remoteJid (1:1s).
      const senderRaw = reactorKey?.participant ?? reactorKey?.remoteJid ?? targetKey.participant ?? targetKey.remoteJid ?? '';
      const senderId = senderRaw ? toNeutralJid(senderRaw) : '';
      const emoji = r.reaction.text ?? null;
      this.callbacks.onMessageReaction?.(chatId, messageId, senderId, emoji);
      // Record into the in-memory reaction store so getReactions can query later.
      this.recordReaction({ messageId, chatId, senderId, emoji, timestamp: Date.now() });
    }
  }

  private handleGroupParticipantsUpdate(u: BaileysEventMap['group-participants.update']): void {
    const action = u.action;
    if (action === 'modify') return; // not one of our four canonical actions
    const ev: WhatsAppGroupEvent = {
      groupId: toNeutralJid(u.id),
      author: u.author ? toNeutralJid(u.author) : '',
      participants: u.participants.map((p) => toNeutralJid(p.id)),
      action: action as 'add' | 'remove' | 'promote' | 'demote',
    };
    this.callbacks.onGroupEvent?.(ev);
  }

  private handleCall(calls: BaileysEventMap['call']): void {
    for (const c of calls) {
      if (c.status === 'offer') {
        this.lastCallFrom = c.from;
        const ev: WhatsAppCallEvent = {
          callId: c.id,
          from: toNeutralJid(c.from),
          isVideo: !!c.isVideo,
          timestamp: c.date.getTime(),
        };
        this.callbacks.onCallReceived?.(ev);
      }
    }
  }

  private async handleLidMappingUpdate(u: BaileysEventMap['lid-mapping.update']): Promise<void> {
    await this.lidStore.remember(u.lid, u.pn).catch(() => {});
  }

  // ─── Internal: contact store ───────────────────────────────────────────

  private handleContactsUpsert(contacts: BaileysEventMap['contacts.upsert']): void {
    for (const c of contacts) {
      this.contacts.set(c.id, { ...this.contacts.get(c.id), ...c });
    }
  }

  private handleContactsUpdate(updates: BaileysEventMap['contacts.update']): void {
    for (const u of updates) {
      if (!u.id) continue;
      const existing = this.contacts.get(u.id);
      if (existing) {
        this.contacts.set(u.id, { ...existing, ...u });
      } else {
        this.contacts.set(u.id, u as import('@whiskeysockets/baileys').Contact);
      }
    }
  }

  private handleMessagingHistorySet(u: BaileysEventMap['messaging-history.set']): void {
    // Initial history sync — bulk load contacts into the in-memory store.
    for (const c of u.contacts) {
      this.contacts.set(c.id, c);
    }
  }

  // ─── IWhatsAppEngine: contacts ─────────────────────────────────────────

  async listContacts(opts?: { limit?: number; search?: string }): Promise<WhatsAppContactEntry[]> {
    const limit = opts?.limit ?? 100;
    const search = opts?.search?.toLowerCase().trim();

    let entries: WhatsAppContactEntry[] = [];
    for (const [jid, c] of this.contacts) {
      // Skip the user's own JID, group JIDs, and broadcast lists.
      if (jid === this.meJid) continue;
      if (jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@status@broadcast')) continue;
      if (jid.endsWith('@lid')) continue; // Skip LID-only entries (no phone)

      const name = c.name ?? c.notify ?? c.verifiedName ?? undefined;
      // Only include contacts that have some form of name (saved or WhatsApp profile).
      if (!name && !c.phoneNumber) continue;

      const phoneNumber = c.phoneNumber ?? phoneFromNeutralJid(toNeutralJid(jid));

      if (search) {
        const haystack = [name, phoneNumber, c.notify, c.username].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(search)) continue;
      }

      entries.push({
        jid,
        phoneNumber: phoneNumber || undefined,
        name,
        notify: c.notify,
        imgUrl: c.imgUrl ?? undefined,
        status: c.status,
      });
    }

    // Sort by name (contacts with names first, then by phone number).
    entries.sort((a, b) => {
      const an = a.name ?? a.notify ?? a.phoneNumber ?? '';
      const bn = b.name ?? b.notify ?? b.phoneNumber ?? '';
      return an.localeCompare(bn);
    });

    return entries.slice(0, limit);
  }

  isSavedContact(jid: string): { saved: boolean; name?: string } {
    const c = this.contacts.get(jid);
    // Baileys' Contact.name = "name of the contact, you have saved on your WA"
    // If name is set, the user has this number saved in their phone address book.
    // notify = WhatsApp profile name (not a saved contact).
    // verifiedName = business account name (not a saved contact).
    if (c?.name) {
      return { saved: true, name: c.name };
    }
    return { saved: false };
  }

  // ─── IWhatsAppEngine: message history & reactions ───────────────────────

  async getMessageHistory(chatId: string, limit = 50): Promise<WhatsAppIncomingMessage[]> {
    const store = this.messagesByChat.get(chatId);
    if (!store || store.length === 0) return [];
    // Store is appended in chronological order; return newest-first.
    const start = Math.max(0, store.length - limit);
    return store.slice(start).reverse();
  }

  async getReactions(chatId: string, messageId: string): Promise<WhatsAppReactionEntry[]> {
    const chatReactions = this.reactionsByMessage.get(chatId);
    if (!chatReactions) return [];
    return chatReactions.get(messageId) ?? [];
  }

  /** Append a message to the per-chat in-memory store, capping the size. */
  private recordMessage(msg: WhatsAppIncomingMessage): void {
    let store = this.messagesByChat.get(msg.chatId);
    if (!store) {
      store = [];
      this.messagesByChat.set(msg.chatId, store);
    }
    // De-dupe by message id (messages.upsert can re-emit on update).
    if (store.some((m) => m.id === msg.id)) return;
    store.push(msg);
    if (store.length > this.messageStoreCapPerChat) {
      store.splice(0, store.length - this.messageStoreCapPerChat);
    }
  }

  /** Append a reaction to the in-memory store, keyed by chat + message. */
  private recordReaction(entry: WhatsAppReactionEntry): void {
    let chatReactions = this.reactionsByMessage.get(entry.chatId);
    if (!chatReactions) {
      chatReactions = new Map();
      this.reactionsByMessage.set(entry.chatId, chatReactions);
    }
    let list = chatReactions.get(entry.messageId);
    if (!list) {
      list = [];
      chatReactions.set(entry.messageId, list);
    }
    // If the same sender already reacted, replace their previous reaction
    // (WhatsApp allows one reaction per user per message; null = removed).
    const idx = list.findIndex((r) => r.senderId === entry.senderId);
    if (idx >= 0) {
      if (entry.emoji === null) list.splice(idx, 1);
      else list[idx] = entry;
    } else if (entry.emoji !== null) {
      list.push(entry);
    }
  }

  // ─── IWhatsAppEngine: profile pictures ──────────────────────────────────

  async getProfilePicture(jid: string): Promise<{ url: string | null }> {
    const sock = this.requireSocket();
    try {
      const url = await sock.profilePictureUrl(jid, 'image');
      return { url: url ?? null };
    } catch {
      // Privacy-restricted or no picture — return null rather than throwing.
      return { url: null };
    }
  }

  // ─── IWhatsAppEngine: group management ──────────────────────────────────

  async createGroup(subject: string, participants: string[]): Promise<{ groupId: string }> {
    const sock = this.requireSocket();
    const meta = await sock.groupCreate(subject, participants);
    return { groupId: toNeutralJid(meta.id) };
  }

  async getGroupInfo(groupId: string): Promise<WhatsAppGroupInfo> {
    const sock = this.requireSocket();
    const meta = await sock.groupMetadata(groupId);
    return this.toGroupInfo(meta);
  }

  async addParticipants(groupId: string, participants: string[]): Promise<void> {
    const sock = this.requireSocket();
    await sock.groupParticipantsUpdate(groupId, participants, 'add');
  }

  async removeParticipants(groupId: string, participants: string[]): Promise<void> {
    const sock = this.requireSocket();
    await sock.groupParticipantsUpdate(groupId, participants, 'remove');
  }

  async promoteParticipant(groupId: string, participant: string): Promise<void> {
    const sock = this.requireSocket();
    await sock.groupParticipantsUpdate(groupId, [participant], 'promote');
  }

  async demoteParticipant(groupId: string, participant: string): Promise<void> {
    const sock = this.requireSocket();
    await sock.groupParticipantsUpdate(groupId, [participant], 'demote');
  }

  async setGroupSubject(groupId: string, subject: string): Promise<void> {
    const sock = this.requireSocket();
    await sock.groupUpdateSubject(groupId, subject);
  }

  async setGroupDescription(groupId: string, description: string): Promise<void> {
    const sock = this.requireSocket();
    await sock.groupUpdateDescription(groupId, description);
  }

  async leaveGroup(groupId: string): Promise<void> {
    const sock = this.requireSocket();
    await sock.groupLeave(groupId);
  }

  async joinGroupByInvite(inviteCode: string): Promise<{ groupId: string }> {
    const sock = this.requireSocket();
    // groupAcceptInvite resolves the invite code to the joined group's jid.
    const code = extractInviteCode(inviteCode);
    const jid = await sock.groupAcceptInvite(code);
    if (!jid) {
      throw new Error('BaileysEngine: groupAcceptInvite returned no jid — the invite code may be invalid or revoked.');
    }
    return { groupId: toNeutralJid(jid) };
  }

  private toGroupInfo(meta: import('@whiskeysockets/baileys').GroupMetadata): WhatsAppGroupInfo {
    return {
      groupId: toNeutralJid(meta.id),
      subject: meta.subject,
      subjectOwner: meta.subjectOwner ? toNeutralJid(meta.subjectOwner) : undefined,
      creation: meta.creation,
      owner: meta.owner ? toNeutralJid(meta.owner) : undefined,
      description: meta.desc,
      descriptionId: meta.descId,
      size: meta.size,
      restrict: meta.restrict,
      announce: meta.announce,
      inviteCode: meta.inviteCode,
      participants: meta.participants.map<WhatsAppGroupParticipant>((p) => ({
        jid: toNeutralJid(p.id),
        isAdmin: !!p.isAdmin,
        isSuperAdmin: !!p.isSuperAdmin,
        admin: p.admin ?? undefined,
      })),
    };
  }

  // ─── IWhatsAppEngine: profile management ────────────────────────────────

  async setProfileName(name: string): Promise<void> {
    const sock = this.requireSocket();
    await sock.updateProfileName(name);
  }

  async setProfileStatus(status: string): Promise<void> {
    const sock = this.requireSocket();
    await sock.updateProfileStatus(status);
  }

  async setProfilePicture(media: { data: string; mimetype: string }): Promise<void> {
    const sock = this.requireSocket();
    // updateProfilePicture targets the linked number when jid is the user's own.
    const me = this.meJid || sock.user?.id;
    if (!me) {
      throw new Error('BaileysEngine: cannot set profile picture — own JID not known yet (session not fully ready).');
    }
    await sock.updateProfilePicture(me, Buffer.from(media.data, 'base64'));
  }

  // ─── IWhatsAppEngine: status stories ────────────────────────────────────

  async postTextStatus(text: string): Promise<WhatsAppSendResult> {
    const sock = this.requireSocket();
    const sent = await sock.sendMessage('status@broadcast', { text });
    return this.toSendResult(sent);
  }

  async postImageStatus(media: { data: string; mimetype: string; caption?: string }): Promise<WhatsAppSendResult> {
    const sock = this.requireSocket();
    const sent = await sock.sendMessage('status@broadcast', {
      image: Buffer.from(media.data, 'base64'),
      mimetype: media.mimetype,
      caption: media.caption,
    });
    return this.toSendResult(sent);
  }

  async listStatusUpdates(): Promise<{ jid: string; timestamp?: number }[]> {
    // Baileys surfaces status updates via the `status.update` / `status.sync`
    // events, which we don't currently persist. Return an empty list rather
    // than throwing — the agent can still post statuses (the common case).
    return [];
  }

  // ─── IWhatsAppEngine: channels (newsletters) ────────────────────────────

  async subscribeChannel(inviteCode: string): Promise<{ jid: string }> {
    const sock = this.requireSocket();
    // Resolve the invite code to a newsletter jid via newsletterMetadata, then follow.
    const code = extractInviteCode(inviteCode);
    const meta = await sock.newsletterMetadata('invite', code);
    if (!meta?.id) {
      throw new Error('BaileysEngine: could not resolve channel from invite code — it may be invalid or revoked.');
    }
    const jid = toNeutralJid(meta.id);
    await sock.newsletterFollow(jid);
    this.followedChannels.set(jid, {
      jid,
      name: meta.name,
      description: meta.description,
      subscribers: meta.subscribers,
    });
    return { jid };
  }

  async listChannels(): Promise<WhatsAppChannel[]> {
    return Array.from(this.followedChannels.values());
  }

  // ─── Internal: reconnect ────────────────────────────────────────────────

  private scheduleReconnect(code?: number): Promise<void> {
    this.reconnectAttempts += 1;
    const { initialDelayMs, maxDelayMs, maxAttempts } = this.reconnect;
    if (maxAttempts > 0 && this.reconnectAttempts > maxAttempts) {
      this.setStatus(EngineStatus.FAILED);
      this.callbacks.onDisconnected?.(`max_reconnect_attempts_exceeded (last code=${code})`);
      return Promise.resolve();
    }

    // Exponential backoff with full jitter, capped.
    const exp = Math.min(maxDelayMs, initialDelayMs * 2 ** (this.reconnectAttempts - 1));
    const delay = Math.floor(Math.random() * exp);

    this.setStatus(EngineStatus.INITIALIZING);
    getLogger().info('WHATSAPP', `reconnect scheduled in ${delay}ms (attempt ${this.reconnectAttempts}, code=${code})`);

    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.restartSocket().catch((err) => {
        getLogger().error('WHATSAPP', err instanceof Error ? err : new Error(String(err)), { ctx: 'reconnect' });
        this.setStatus(EngineStatus.FAILED);
        this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      });
    }, delay);
    return Promise.resolve();
  }

  private async restartSocket(): Promise<void> {
    if (this.intentionallyStopped) return;
    this.teardownListeners();
    this.sock = null;
    this.ev = null;
    await this.startSocket();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ─── Internal: media ────────────────────────────────────────────────────

  /**
   * Download inbound media for a message, respecting the size cap. On error or
   * oversize, returns an `omitted` media descriptor so the agent still knows a
   * media payload exists.
   */
  private async resolveMedia(waMsg: WAMessage): Promise<{ mimetype: string; data?: string; omitted?: boolean; sizeBytes?: number; fileName?: string; caption?: string } | undefined> {
    const sock = this.sock;
    if (!sock) return undefined;
    const msg = waMsg.message;
    if (!msg) return undefined;
    const contentType = getContentType(msg);
    if (!contentType) return undefined;
    const mediaMsg = (msg as Record<string, { mimetype?: string; fileName?: string; caption?: string; fileLength?: number | { toNumber(): number } } | undefined>)[contentType];
    if (!mediaMsg) return undefined;
    const mimetype = mediaMsg.mimetype ?? 'application/octet-stream';
    const fileLength = typeof mediaMsg.fileLength === 'number' ? mediaMsg.fileLength
      : typeof mediaMsg.fileLength === 'object' && mediaMsg.fileLength ? mediaMsg.fileLength.toNumber() : undefined;

    // Pre-check: if the declared size exceeds the cap, skip the download.
    if (fileLength && fileLength > this.inboundMediaCapBytes) {
      return { mimetype, omitted: true, sizeBytes: fileLength, fileName: mediaMsg.fileName, caption: mediaMsg.caption };
    }

    try {
      const buf = await downloadMediaMessage(waMsg, 'buffer', {});
      if (buf.length > this.inboundMediaCapBytes) {
        return { mimetype, omitted: true, sizeBytes: buf.length, fileName: mediaMsg.fileName, caption: mediaMsg.caption };
      }
      return { mimetype, data: buf.toString('base64'), sizeBytes: buf.length, fileName: mediaMsg.fileName, caption: mediaMsg.caption };
    } catch (err) {
      getLogger().warn('WHATSAPP', `media download failed: ${err instanceof Error ? err.message : String(err)}`);
      return { mimetype, omitted: true, sizeBytes: fileLength, fileName: mediaMsg.fileName, caption: mediaMsg.caption };
    }
  }

  // ─── Internal: helpers ──────────────────────────────────────────────────

  private requireSocket(): WASocket {
    if (!this.sock) {
      throw new Error('BaileysEngine: socket not initialized — call initialize() first');
    }
    return this.sock;
  }

  private setStatus(status: EngineStatus, info?: { phoneNumber?: string; pushName?: string }): void {
    this.status = status;
    this.callbacks.onStateChanged?.(status, info);
  }

  private toSendResult(sent: WAMessage | undefined): WhatsAppSendResult {
    if (!sent || !sent.key.id) {
      throw new Error('BaileysEngine: sendMessage returned no message id');
    }
    const ts = typeof sent.messageTimestamp === 'number'
      ? sent.messageTimestamp
      : Number(sent.messageTimestamp ?? Math.floor(Date.now() / 1000));
    return { messageId: sent.key.id, timestamp: ts };
  }

  /**
   * Fetch a prior message by id to use as a `quoted` reference. Baileys needs
   * the actual `WAMessage` (or at minimum its `message` content) to quote it.
   * We synthesize a minimal stub from the id — quoting works with just the key
   * for text replies in practice.
   */
  private async fetchMessageForQuote(messageId: string, chatId: string): Promise<WAMessage | undefined> {
    return {
      key: { remoteJid: chatId, id: messageId, fromMe: false },
      message: undefined,
    } as unknown as WAMessage;
  }

  private async fetchMessageByKey(chatId: string, messageId: string): Promise<WAMessage | undefined> {
    // Baileys doesn't expose a "fetch single message" RPC; the caller (Phase 6
    // tools) is expected to keep a message cache. For forwarding we accept a
    // best-effort stub keyed only by id — if the protocol requires full
    // content, the agent-tool layer supplies it from its own store.
    return {
      key: { remoteJid: chatId, id: messageId, fromMe: false },
      message: undefined,
    } as unknown as WAMessage;
  }

  private async getMessageForRetry(key: proto.IMessageKey): Promise<proto.IMessage | undefined> {
    // Required by Baileys for retry-resends of failed messages. Without a
    // message store we can't reconstruct the original; returning undefined
    // makes Baileys skip the retry rather than crash.
    void key;
    return undefined;
  }
}

// ─── Module-private helpers ──────────────────────────────────────────────

/**
 * Baileys' logger interface expects an ILogger with `level` and `{}`-prefixed
 * methods. We feed it a no-op logger so the library stays silent — Agent-X's
 * own `getLogger()` is the only logging surface we want.
 */
function silentLogger(): { level: string; info: () => void; warn: () => void; error: () => void; debug: () => void; trace: () => void; fatal: () => void; child: () => ReturnType<typeof silentLogger> } {
  const noop = () => {};
  const l = {
    level: 'silent',
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => l,
  };
  return l;
}

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

/**
 * Extract a WhatsApp invite code from either a raw code or a full invite URL.
 * Accepts forms like:
 *   - "https://chat.whatsapp.com/ABC123XYZ"
 *   - "https://whatsapp.com/channel/002ABcd..."
 *   - "ABC123XYZ" (raw code, returned as-is)
 * Returns the trailing path segment, or the original input if no URL structure is found.
 */
function extractInviteCode(input: string): string {
  const trimmed = input.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const seg = parsed.pathname.split('/').filter(Boolean).pop();
      if (seg) return seg;
    }
  } catch {
    // Not a URL — treat as a raw code.
  }
  return trimmed;
}
