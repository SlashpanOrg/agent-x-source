/**
 * WhatsAppSessionService — lifecycle manager for the single WhatsApp session.
 *
 * Per §3.1–3.5 of WHATSAPP_INTEGRATION_PLAN.md, this service owns the single
 * `IWhatsAppEngine` instance and manages its lifecycle:
 *   - `link()` — start the QR/pairing flow
 *   - `getStatus()` — current status snapshot
 *   - `getQr()` — current QR code (if any)
 *   - `requestPairingCode(phone)` — switch to pairing-code flow
 *   - `stop()` — graceful disconnect
 *   - `forceKill()` — hard kill for a wedged engine
 *   - `unlink()` — delete credentials + purge all session data
 *
 * It also:
 *   - Wires all engine callbacks through {@link WhatsAppEventBus} (§3.6)
 *   - Runs a watchdog liveness probe (§3.3)
 *   - Reconciles stale session state on boot (§3.4)
 *   - Graceful shutdown with timeout (§3.5)
 *
 * Single-session scope (Ground Rule 7): no session-id parameter anywhere.
 *
 * Written from scratch for Agent-X — not copied from any reference project.
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { getLogger } from '@agentx/shared';

import { WhatsAppEventBus } from './WhatsAppEventBus.js';
import { hasRegisteredWhatsAppCreds, purgeWhatsAppAuthState, type SessionRow } from './WhatsAppStore.js';
import { createWhatsAppEngine, type WhatsAppEngineKind } from './engine/EngineFactory.js';
import { EngineStatus } from './engine/IWhatsAppEngine.js';
import type {
  IWhatsAppEngine,
  WhatsAppEngineCallbacks,
  WhatsAppContactEntry,
  WhatsAppIncomingMessage,
} from './engine/IWhatsAppEngine.js';
import { toNeutralJid } from './identity/wa-id.js';
import type { ContactDirectoryStore } from './contacts/ContactDirectoryStore.js';
import { getAttachmentService } from '../attachments/index.js';
import { visualKindFromMime } from '@agentx/shared';
import { waUnixTimestamp } from './wa-timestamp.js';
import { isAgentMarkedBody } from './jarvis/constants.js';

/** Single-row id for the whatsapp_session table. */
const SESSION_ID = 'default';

function isRemoteLogout(reason: string | undefined): boolean {
  return Boolean(reason && /^logged_out\b/i.test(reason));
}

/** Watchdog configuration. */
export interface WatchdogConfig {
  /** Probe interval in milliseconds. Default: 60_000 (1 min). */
  intervalMs?: number;
  /** Probe timeout in milliseconds. Default: 10_000. */
  timeoutMs?: number;
  /** Number of consecutive failures before triggering a reconnect. Default: 3. */
  failureThreshold?: number;
}

/** Configuration for WhatsAppSessionService. */
export interface WhatsAppSessionServiceOptions {
  pool: Pool;
  dek: Buffer;
  /** Which engine to use. Defaults to 'baileys' (§0.1 policy). */
  engine?: WhatsAppEngineKind;
  /** Forwarded to EngineFactory for Baileys engine. */
  baileys?: Record<string, unknown>;
  /** Forwarded to EngineFactory for ElectronWebJsEngine. */
  electronWwebJs?: Record<string, unknown>;
  /** Watchdog config. */
  watchdog?: WatchdogConfig;
  /** Graceful shutdown timeout in ms. Default: 5_000. */
  shutdownTimeoutMs?: number;
}

/** Public status snapshot. */
export interface WhatsAppSessionStatus {
  status: EngineStatus;
  engine: WhatsAppEngineKind;
  phoneNumber?: string;
  pushName?: string;
  lastError?: string;
  connectedAt?: Date;
  lastActiveAt?: Date;
  /** QR code as PNG data URL — present when status is QR_READY. */
  qrDataUrl?: string;
}

/**
 * Lifecycle manager for the single WhatsApp session.
 *
 * This class is NOT thread-safe across multiple Electron renderer processes —
 * it's designed to run in the engine process (main or a dedicated worker),
 * with a single instance managing the single WhatsApp session.
 */
export class WhatsAppSessionService {
  private readonly pool: Pool;
  private readonly dek: Buffer;
  private readonly engineKind: WhatsAppEngineKind;
  private readonly engineOpts: Record<string, unknown>;
  private readonly watchdog: Required<WatchdogConfig>;
  private readonly shutdownTimeoutMs: number;
  /**
   * Soft-pause flag. When true, the service is paused due to a protocol break
   * or version upgrade. Set externally via the `paused` setter.
   */
  private _paused = false;

  /** Recent self-chat outbound ids so Jarvis can drop our own echoes. */
  private readonly recentOutboundIds = new Set<string>();
  private readonly recentOutboundOrder: string[] = [];

  private engine: IWhatsAppEngine | null = null;
  private eventBus: WhatsAppEventBus = new WhatsAppEventBus();
  private initializing = false;
  private stopping = false;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private watchdogFailures = 0;
  private currentPhoneNumber?: string;
  private currentPushName?: string;
  private currentError?: string;
  private currentQrDataUrl?: string;
  private contactDirectory: ContactDirectoryStore | null = null;
  private pendingContactEntries: WhatsAppContactEntry[] = [];
  private contactFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private contactReadySyncTimer: ReturnType<typeof setTimeout> | null = null;
  private contactRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly persistInflight = new Map<string, Promise<void>>();
  /** Last inbound "Message yourself" chat id (often the owner's LID). */
  private lastSelfChatId: string | null = null;

  constructor(opts: WhatsAppSessionServiceOptions) {
    this.pool = opts.pool;
    this.dek = opts.dek;
    this.engineKind = opts.engine ?? 'baileys';
    this.engineOpts = this.engineKind === 'electron-wwebjs' ? (opts.electronWwebJs ?? {}) : (opts.baileys ?? {});
    this.watchdog = {
      intervalMs: opts.watchdog?.intervalMs ?? 60_000,
      timeoutMs: opts.watchdog?.timeoutMs ?? 10_000,
      failureThreshold: opts.watchdog?.failureThreshold ?? 3,
    };
    this.shutdownTimeoutMs = opts.shutdownTimeoutMs ?? 5_000;
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  /** The event bus — consumers subscribe here, never directly on the engine. */
  get events(): WhatsAppEventBus {
    return this.eventBus;
  }

  /**
   * Returns the active engine instance, or null if the session is not linked.
   * Used by the agent-tool surface (Phase 6) to access messaging/contact/group
   * operations. Tools should check the return value and report a clear error
   * if the session is not ready.
   */
  getEngine(): IWhatsAppEngine | null {
    return this.engine;
  }

  /** Neutral owner JIDs for the linked handset (self-chat). */
  getOwnerJids(): string[] {
    const out = new Set<string>();
    const phone = (this.currentPhoneNumber ?? '').replace(/\D/g, '');
    if (phone) out.add(`${phone}@c.us`);
    for (const jid of this.engine?.getLinkedUserJids?.() ?? []) {
      const n = toNeutralJid(jid);
      if (n) out.add(n);
    }
    return [...out];
  }

  /** WhatsApp "Message yourself" chat id, or null if the number is unknown. */
  getSelfChatId(): string | null {
    if (this.lastSelfChatId) return this.lastSelfChatId;
    const jids = this.getOwnerJids();
    const lid = jids.find((j) => j.endsWith('@lid'));
    if (lid) return lid;
    return jids[0] ?? null;
  }

  rememberSelfChatId(chatId: string): void {
    const n = toNeutralJid(chatId) || chatId.trim();
    if (n) this.lastSelfChatId = n;
  }

  rememberOutboundId(id: string): void {
    if (!id) return;
    this.recentOutboundIds.add(id);
    this.recentOutboundOrder.push(id);
    while (this.recentOutboundOrder.length > 64) {
      const old = this.recentOutboundOrder.shift();
      if (old) this.recentOutboundIds.delete(old);
    }
  }

  setContactDirectory(store: ContactDirectoryStore | null): void {
    this.contactDirectory = store;
  }

  getContactDirectory(): ContactDirectoryStore | null {
    return this.contactDirectory;
  }

  getRecentOutboundIds(): Set<string> {
    return this.recentOutboundIds;
  }

  async persistInboundMessage(msg: WhatsAppIncomingMessage): Promise<void> {
    await this.persistWhatsAppMessage(msg);
  }

  async persistWhatsAppMessage(msg: WhatsAppIncomingMessage): Promise<void> {
    const waId = msg.id || randomUUID();
    const existing = this.persistInflight.get(waId);
    if (existing) {
      await existing;
      return;
    }
    const run = this.writeWhatsAppMessage(msg, waId).finally(() => {
      this.persistInflight.delete(waId);
    });
    this.persistInflight.set(waId, run);
    await run;
  }

  private async writeWhatsAppMessage(msg: WhatsAppIncomingMessage, waId: string): Promise<void> {
    const attachmentId = msg.attachmentId ?? await this.persistInboundMedia(msg);
    if (attachmentId) msg.attachmentId = attachmentId;
    const direction = msg.fromMe ? 'outbound' : 'inbound';
    const actor = msg.fromMe
      ? (isAgentMarkedBody(msg.body) ? 'agent' : 'owner')
      : 'contact';
    await this.pool.query(
      `INSERT INTO whatsapp_messages
         (id, wa_message_id, chat_id, direction, "from", "to", body, type, status, timestamp, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
       ON CONFLICT (wa_message_id) DO UPDATE SET
         body = COALESCE(NULLIF(EXCLUDED.body, ''), whatsapp_messages.body),
         metadata = whatsapp_messages.metadata || EXCLUDED.metadata,
         status = EXCLUDED.status,
         type = CASE
           WHEN EXCLUDED.type IS NOT NULL AND EXCLUDED.type <> 'unknown' THEN EXCLUDED.type
           ELSE whatsapp_messages.type
         END,
         timestamp = COALESCE(EXCLUDED.timestamp, whatsapp_messages.timestamp)`,
      [
        randomUUID(),
        waId,
        toNeutralJid(msg.chatId || msg.from) || msg.chatId || '',
        direction,
        toNeutralJid(msg.author ?? msg.from) || msg.from || '',
        toNeutralJid(msg.to || '') || msg.to || '',
        msg.body ?? '',
        msg.type,
        msg.fromMe ? 'sent' : 'received',
        waUnixTimestamp(msg.timestamp),
        JSON.stringify({
          isGroup: msg.isGroup,
          fromMe: msg.fromMe,
          actor,
          pushName: msg.pushName ?? null,
          author: msg.author ?? null,
          mediaCaption: msg.media?.caption ?? null,
          mediaOmitted: msg.media?.omitted ?? false,
          mediaFileName: msg.media?.fileName ?? null,
          ...(msg.location ? { location: msg.location } : {}),
          ...(attachmentId ? { storageId: attachmentId, mediaMime: msg.media?.mimetype ?? null } : {}),
        }),
      ],
    );
  }

  async listPersistedMessages(opts: {
    chatId?: string;
    query?: string;
    limit?: number;
  } = {}): Promise<Array<{
    waMessageId: string;
    chatId: string;
    direction: string;
    from: string;
    to: string;
    body: string;
    type: string;
    timestamp: number;
    metadata: Record<string, unknown>;
  }>> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const params: unknown[] = [];
    const where: string[] = [];
    if (opts.chatId?.trim()) {
      params.push(toNeutralJid(opts.chatId) || opts.chatId.trim());
      where.push(`chat_id = $${params.length}`);
    }
    if (opts.query?.trim()) {
      params.push(`%${opts.query.trim()}%`);
      where.push(`(body ILIKE $${params.length} OR "from" ILIKE $${params.length} OR metadata->>'pushName' ILIKE $${params.length})`);
    }
    params.push(limit);
    const sql = `SELECT wa_message_id AS "waMessageId", chat_id AS "chatId", direction,
                        "from", "to", body, type, timestamp, metadata
                 FROM whatsapp_messages
                 ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY timestamp DESC
                 LIMIT $${params.length}`;
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => ({
      waMessageId: String(row.waMessageId ?? ''),
      chatId: String(row.chatId ?? ''),
      direction: String(row.direction ?? ''),
      from: String(row.from ?? ''),
      to: String(row.to ?? ''),
      body: String(row.body ?? ''),
      type: String(row.type ?? 'text'),
      timestamp: Number(row.timestamp) || 0,
      metadata: (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>,
    }));
  }

  private async persistInboundMedia(msg: WhatsAppIncomingMessage): Promise<string | undefined> {
    const media = msg.media;
    if (!media?.data || media.omitted) return undefined;
    try {
      const kind = visualKindFromMime(media.mimetype, 'document');
      const ext = media.fileName?.includes('.')
        ? media.fileName.slice(media.fileName.lastIndexOf('.'))
        : kind === 'image' ? '.jpg' : kind === 'video' ? '.mp4' : '.bin';
      const filename = media.fileName?.trim() || `whatsapp-${kind}-${msg.id || 'media'}${ext}`;
      const stored = await getAttachmentService().registerAttachment({
        sessionId: '__channel__:voice',
        filename,
        mimeType: media.mimetype,
        buffer: Buffer.from(media.data, 'base64'),
        source: 'whatsapp',
      });
      return stored.id;
    } catch (err) {
      getLogger().warn(
        'WHATSAPP',
        `Inbound media persist skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }

  /** Whether WhatsApp is soft-paused (protocol break / version upgrade). */
  get paused(): boolean {
    return this._paused;
  }

  /** Set the soft-pause flag. When pausing, stops the active engine if any. */
  set paused(value: boolean) {
    this._paused = value;
  }

  /**
   * Start the linking flow (QR or pairing code). Creates the engine if needed,
   * wires callbacks to the event bus, and calls `engine.initialize()`.
   *
   * If credentials already exist in the DB, the engine will attempt to
   * reconnect silently (no QR needed).
   */
  async link(): Promise<void> {
    // Idempotent while a live handshake or socket is up. A dead engine
    // (FAILED / DISCONNECTED leftover after a drop) must be replaced.
    if (this.engine) {
      const live = this.engine.getStatus();
      if (
        live === EngineStatus.READY
        || live === EngineStatus.QR_READY
        || live === EngineStatus.AUTHENTICATING
        || live === EngineStatus.INITIALIZING
        || live === EngineStatus.PAIRING
      ) {
        return;
      }
      getLogger().info('WHATSAPP', `link(): replacing dead engine (status=${live})`);
      try { await this.engine.forceDestroy(); } catch { /* best-effort */ }
      this.engine = null;
    }
    if (this.initializing) {
      return;
    }
    this.initializing = true;
    this.stopping = false;
    this.currentError = undefined;
    this.currentQrDataUrl = undefined;

    // Only wipe unregistered leftover noise from a failed QR handshake.
    // A completed link (creds.registered) must survive app restarts, Stop,
    // watchdog reconnects, and transient disconnects — like WhatsApp Web.
    const registered = await hasRegisteredWhatsAppCreds(this.pool, this.dek);
    if (!registered) {
      getLogger().info('WHATSAPP', 'link(): no registered session — clearing leftover unregistered auth material');
      try {
        await purgeWhatsAppAuthState(this.pool, this.dek);
      } catch (err) {
        getLogger().warn('WHATSAPP', `link(): leftover auth purge failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      getLogger().info('WHATSAPP', 'link(): registered session found — reconnecting silently (no QR)');
    }

    try {
      // Persist initial session state
      await this.upsertSessionRow(EngineStatus.INITIALIZING);

      // Create the engine
      this.engine = createWhatsAppEngine({
        pool: this.pool,
        dek: this.dek,
        engine: this.engineKind,
        baileys: this.engineOpts as never,
        electronWwebJs: this.engineOpts as never,
      });

      // Wire callbacks → event bus
      this.engine.setCallbacks(this.buildCallbacks());

      // Initialize
      await this.engine.initialize();
      await this.upsertSessionRow(this.engine.getStatus());

      // Start watchdog
      this.startWatchdog();
    } catch (err) {
      this.currentError = err instanceof Error ? err.message : String(err);
      await this.upsertSessionRow(EngineStatus.FAILED, { lastError: this.currentError });
      this.eventBus.emit('error', err instanceof Error ? err : new Error(String(err)));
      // Clean up partial state
      if (this.engine) {
        try { await this.engine.forceDestroy(); } catch { /* best-effort */ }
        this.engine = null;
      }
      throw err;
    } finally {
      this.initializing = false;
    }
  }

  /** Current status snapshot. */
  async getStatus(): Promise<WhatsAppSessionStatus> {
    const row = await this.readSessionRow();
    // Prefer the live engine status. If the engine is null (e.g. hasn't
    // been started yet but we have a previous session in the DB), fall back
    // to the DB row status so the UI doesn't falsely show "disconnected"
    // when WhatsApp is actually linked but the engine hasn't been started.
    const engineStatus = this.engine?.getStatus() ?? (row?.status as EngineStatus) ?? EngineStatus.DISCONNECTED;
    if (!this.currentPhoneNumber && row?.phone_number) {
      this.currentPhoneNumber = row.phone_number;
    }
    return {
      status: engineStatus,
      engine: this.engineKind,
      phoneNumber: this.currentPhoneNumber ?? row?.phone_number ?? undefined,
      pushName: this.currentPushName ?? row?.push_name ?? undefined,
      lastError: this.currentError ?? row?.last_error ?? undefined,
      connectedAt: row?.connected_at ? new Date(row.connected_at) : undefined,
      lastActiveAt: row?.last_active_at ? new Date(row.last_active_at) : undefined,
      qrDataUrl: this.currentQrDataUrl,
    };
  }

  /** Current QR code as a PNG data URL, or null if not in QR_READY state. */
  getQr(): string | null {
    // Return the cached data URL from the onQRCode callback — the engine's
    // getQr() returns the raw QR string, not a rendered PNG data URL.
    return this.currentQrDataUrl ?? null;
  }

  /**
   * Wait for the QR code to be generated (up to `timeoutMs`).
   * Baileys generates the QR asynchronously after initialize() returns,
   * so the caller needs to wait for it to appear.
   * Returns the QR data URL, or null if it doesn't appear in time.
   */
  async waitForQr(timeoutMs = 15_000): Promise<string | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.currentQrDataUrl) return this.currentQrDataUrl;
      // Also check if we're already ready (no QR needed)
      if (this.engine?.getStatus() === EngineStatus.READY) return null;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return this.currentQrDataUrl ?? null;
  }

  /**
   * Request a pairing code instead of QR. Must be called after `link()`
   * (the engine must be initialized and listening for QR).
   */
  async requestPairingCode(phoneNumber: string): Promise<string> {
    if (!this.engine) {
      throw new Error('WhatsAppSessionService: cannot request pairing code — call link() first');
    }
    return this.engine.requestPairingCode(phoneNumber);
  }

  /** Graceful disconnect — engine may be reused/reinitialized afterwards. */
  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.stopWatchdog();
    this.stopContactSync();

    const engine = this.engine;
    if (!engine) {
      this.stopping = false;
      await this.upsertSessionRow(EngineStatus.DISCONNECTED);
      return;
    }

    try {
      await this.withTimeout(engine.disconnect(), this.shutdownTimeoutMs, 'disconnect');
      await this.upsertSessionRow(EngineStatus.DISCONNECTED);
    } catch (err) {
      getLogger().warn('WHATSAPP', `SessionService.stop: disconnect failed, force-killing: ${err instanceof Error ? err.message : String(err)}`);
      try { await engine.forceDestroy(); } catch { /* ignore */ }
      await this.upsertSessionRow(EngineStatus.DISCONNECTED);
    }
    this.engine = null;
    this.currentQrDataUrl = undefined;
    this.stopping = false;
  }

  /** Hard kill for a wedged engine. */
  async forceKill(): Promise<void> {
    this.stopWatchdog();
    this.stopContactSync();
    const engine = this.engine;
    if (engine) {
      try { await engine.forceDestroy(); } catch { /* ignore */ }
    }
    this.engine = null;
    this.currentQrDataUrl = undefined;
    this.stopping = false;
    this.initializing = false;
    await this.upsertSessionRow(EngineStatus.DISCONNECTED);
  }

  /**
   * Unlink — revoke the device on WhatsApp (like logging out of WhatsApp Web),
   * then delete stored credentials. Only the owner should call this.
   */
  async unlink(): Promise<void> {
    if (this.engine?.logoutFromServer) {
      try { await this.engine.logoutFromServer(); } catch { /* already closed */ }
    }
    await this.stop();
    try {
      await purgeWhatsAppAuthState(this.pool, this.dek);
    } catch (err) {
      getLogger().error('WHATSAPP', err instanceof Error ? err : new Error(String(err)), { ctx: 'unlink-purge' });
    }
    await this.deleteSessionRow();
    await this.contactDirectory?.purge();
    this.currentPhoneNumber = undefined;
    this.currentPushName = undefined;
    this.currentError = undefined;
    this.currentQrDataUrl = undefined;
    this.eventBus.clear();
  }

  /**
   * Boot-time reconciliation. A completed QR link persists like WhatsApp Web:
   * if registered creds (or a previously linked phone) exist, reconnect
   * silently. Incomplete QR attempts are reset to disconnected.
   */
  async reconcileOnBoot(): Promise<void> {
    const registered = await hasRegisteredWhatsAppCreds(this.pool, this.dek);
    const row = await this.readSessionRow();
    const wasLinked = registered || Boolean(row?.phone_number);

    if (wasLinked) {
      getLogger().info('WHATSAPP', 'Persisted WhatsApp link found — reconnecting silently (no QR)');
      try {
        await this.link();
        this._paused = false;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        getLogger().warn('WHATSAPP', `Auto-reconnect failed: ${errMsg} — entering paused state`);
        await this.upsertSessionRow(EngineStatus.DISCONNECTED, {
          lastError: `Auto-reconnect failed: ${errMsg}`,
        });
        this._paused = true;
      }
      return;
    }

    if (!row) return;

    const staleStates: EngineStatus[] = [EngineStatus.INITIALIZING, EngineStatus.QR_READY, EngineStatus.PAIRING, EngineStatus.AUTHENTICATING];
    if (staleStates.includes(row.status as EngineStatus)) {
      getLogger().info('WHATSAPP', `Reconciling stale session state '${row.status}' → 'disconnected'`);
      await this.upsertSessionRow(EngineStatus.DISCONNECTED);
    }
  }

  /**
   * Retry connecting after a soft-pause. Attempts to link again — if it
   * succeeds, clears the paused flag and returns true. If it still fails,
   * keeps the paused flag and returns false (does not throw).
   */
  async retry(): Promise<boolean> {
    if (this._paused === false) {
      // Already connected or not paused — nothing to retry
      return true;
    }
    // Clean up any leftover engine state from a failed attempt
    if (this.engine) {
      try { await this.engine.forceDestroy(); } catch { /* best-effort */ }
      this.engine = null;
    }
    this.initializing = false;
    this.stopping = false;
    try {
      await this.link();
      this._paused = false;
      getLogger().info('WHATSAPP', 'Retry succeeded — WhatsApp reconnected, paused flag cleared');
      return true;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      getLogger().warn('WHATSAPP', `Retry failed: ${errMsg} — staying paused`);
      this._paused = true;
      return false;
    }
  }

  /** Graceful shutdown helper — call on Electron app quit. */
  async shutdown(): Promise<void> {
    await this.stop();
  }

  // ─── Internal: callback wiring ──────────────────────────────────────────

  private buildCallbacks(): WhatsAppEngineCallbacks {
    return {
      onQRCode: (dataUrl) => {
        this.currentQrDataUrl = dataUrl;
        this.eventBus.emit('qrCode', dataUrl);
      },
      onPairingCode: (code) => this.eventBus.emit('pairingCode', code),
      onStateChanged: (status, info) => {
        if (info?.phoneNumber) this.currentPhoneNumber = info.phoneNumber;
        if (info?.pushName) this.currentPushName = info.pushName;
        // Clear cached QR when we're past the QR stage (ready, disconnected, etc.)
        if (status === EngineStatus.READY || status === EngineStatus.DISCONNECTED) {
          this.currentQrDataUrl = undefined;
        }
        this.eventBus.emit('stateChanged', status, info);
        // Persist status transitions to DB
        void this.upsertSessionRow(status, {
          phoneNumber: this.currentPhoneNumber,
          pushName: this.currentPushName,
          connectedAt: status === EngineStatus.READY ? new Date() : undefined,
        });
        if (status === EngineStatus.READY) {
          this.scheduleContactSync();
        }
      },
      onMessage: (msg) => {
        const owners = new Set(this.getOwnerJids());
        if (owners.has(toNeutralJid(msg.chatId)) || owners.has(toNeutralJid(msg.from))) {
          this.rememberSelfChatId(msg.chatId);
        }
        void this.persistWhatsAppMessage(msg)
          .catch((err) => {
            getLogger().warn(
              'WHATSAPP',
              `Persist inbound failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          })
          .finally(() => {
            this.eventBus.emit('message', msg);
            void this.touchLastActive();
          });
      },
      onMessageSent: (msg) => {
        void this.persistWhatsAppMessage(msg)
          .catch((err) => {
            getLogger().warn(
              'WHATSAPP',
              `Persist outbound failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          })
          .finally(() => {
            this.eventBus.emit('messageSent', msg);
            void this.touchLastActive();
          });
      },
      onMessageAck: (ack) => this.eventBus.emit('messageAck', ack),
      onMessageRevoked: (chatId, messageId) => this.eventBus.emit('messageRevoked', chatId, messageId),
      onMessageEdited: (msg) => {
        void this.persistWhatsAppMessage(msg)
          .catch((err) => {
            getLogger().warn(
              'WHATSAPP',
              `Persist edit failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          })
          .finally(() => {
            this.eventBus.emit('messageEdited', msg);
          });
      },
      onMessageReaction: (chatId, messageId, senderId, emoji) =>
        this.eventBus.emit('messageReaction', chatId, messageId, senderId, emoji),
      onGroupEvent: (event) => this.eventBus.emit('groupEvent', event),
      onCallReceived: (call) => this.eventBus.emit('callReceived', call),
      onDisconnected: (reason) => {
        this.eventBus.emit('disconnected', reason);
        if (isRemoteLogout(reason)) {
          void this.handleRemoteLogout(reason);
          return;
        }
        void this.upsertSessionRow(EngineStatus.DISCONNECTED);
        // Baileys reconnects itself while INITIALIZING. A dead socket
        // (wwebjs, or Baileys after a hard fail) is recovered here.
        const live = this.engine?.getStatus();
        if (
          !this.stopping
          && !this._paused
          && (live === EngineStatus.DISCONNECTED || live === EngineStatus.FAILED || !this.engine)
        ) {
          void this.recoverLinkedSession();
        }
      },
      onError: (error) => {
        this.currentError = error.message;
        this.eventBus.emit('error', error);
        void this.upsertSessionRow(this.engine?.getStatus() ?? EngineStatus.FAILED, { lastError: error.message });
      },
      onContactsChanged: (contacts) => {
        this.eventBus.emit('contactsChanged', contacts);
        this.queueContactSync(contacts);
      },
    };
  }

  private queueContactSync(contacts: WhatsAppContactEntry[]): void {
    if (contacts.length === 0) return;
    this.pendingContactEntries.push(...contacts);
    if (this.contactFlushTimer) clearTimeout(this.contactFlushTimer);
    this.contactFlushTimer = setTimeout(() => void this.flushContactSync(), 400);
  }

  private async flushContactSync(): Promise<void> {
    const batch = this.pendingContactEntries;
    this.pendingContactEntries = [];
    this.contactFlushTimer = null;
    if (batch.length === 0 || !this.contactDirectory) return;
    const n = await this.contactDirectory.upsertFromEngine(batch);
    if (n > 0) {
      getLogger().info('WHATSAPP', `Indexed ${n} WhatsApp contact(s) (${this.contactDirectory.count()} total)`);
    }
  }

  private scheduleContactSync(): void {
    void this.syncContactsFromEngine();
    if (this.contactReadySyncTimer) clearTimeout(this.contactReadySyncTimer);
    this.contactReadySyncTimer = setTimeout(() => void this.syncContactsFromEngine(), 30_000);
    if (this.contactRefreshTimer) clearInterval(this.contactRefreshTimer);
    this.contactRefreshTimer = setInterval(() => void this.syncContactsFromEngine(), 15 * 60_000);
  }

  async syncContactsFromEngine(): Promise<number> {
    const engine = this.engine;
    if (!engine?.listContacts || !this.contactDirectory) return 0;
    try {
      const contacts = await engine.listContacts({ limit: 50_000 });
      const n = await this.contactDirectory.upsertFromEngine(contacts);
      getLogger().info('WHATSAPP', `WhatsApp contact directory sync: ${n} upserted, ${this.contactDirectory.count()} indexed`);
      return n;
    } catch (err) {
      getLogger().warn('WHATSAPP', `Contact directory sync failed: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }
  }

  private stopContactSync(): void {
    if (this.contactFlushTimer) {
      clearTimeout(this.contactFlushTimer);
      this.contactFlushTimer = null;
    }
    if (this.contactReadySyncTimer) {
      clearTimeout(this.contactReadySyncTimer);
      this.contactReadySyncTimer = null;
    }
    if (this.contactRefreshTimer) {
      clearInterval(this.contactRefreshTimer);
      this.contactRefreshTimer = null;
    }
    this.pendingContactEntries = [];
  }

  // ─── Internal: watchdog (§3.3) ──────────────────────────────────────────

  private startWatchdog(): void {
    this.stopWatchdog();
    this.watchdogFailures = 0;
    this.watchdogTimer = setInterval(() => void this.runWatchdogProbe(), this.watchdog.intervalMs);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private async runWatchdogProbe(): Promise<void> {
    const engine = this.engine;
    if (!engine || this.stopping) return;

    try {
      const alive = await this.withTimeout(
        engine.probeLiveness?.() ?? Promise.resolve(true),
        this.watchdog.timeoutMs,
        'liveness-probe',
      );
      if (alive) {
        this.watchdogFailures = 0;
      } else {
        this.watchdogFailures++;
        getLogger().warn('WHATSAPP', `Watchdog: liveness probe failed (${this.watchdogFailures}/${this.watchdog.failureThreshold})`);
        if (this.watchdogFailures >= this.watchdog.failureThreshold) {
          getLogger().warn('WHATSAPP', `Watchdog: failure threshold reached — forcing reconnect`);
          await this.forceReconnect();
        }
      }
    } catch (err) {
      this.watchdogFailures++;
      getLogger().warn('WHATSAPP', `Watchdog: probe error (${this.watchdogFailures}/${this.watchdog.failureThreshold}): ${err instanceof Error ? err.message : String(err)}`);
      if (this.watchdogFailures >= this.watchdog.failureThreshold) {
        await this.forceReconnect();
      }
    }
  }

  private async forceReconnect(): Promise<void> {
    this.watchdogFailures = 0;
    const oldEngine = this.engine;
    this.engine = null;
    if (oldEngine) {
      try { await oldEngine.forceDestroy(); } catch { /* ignore */ }
    }
    try {
      await this.link();
    } catch (err) {
      getLogger().error('WHATSAPP', err instanceof Error ? err : new Error(String(err)), { ctx: 'watchdog-reconnect' });
    }
  }

  /** Phone revoked the linked device — drop auth and require a new QR. */
  private async handleRemoteLogout(reason: string): Promise<void> {
    getLogger().warn('WHATSAPP', `WhatsApp logged out remotely (${reason}) — credentials purged; scan QR to link again`);
    this.stopWatchdog();
    this.stopContactSync();
    const engine = this.engine;
    this.engine = null;
    if (engine) {
      try { await engine.forceDestroy(); } catch { /* already closed */ }
    }
    try {
      await purgeWhatsAppAuthState(this.pool, this.dek);
    } catch (err) {
      getLogger().error('WHATSAPP', err instanceof Error ? err : new Error(String(err)), { ctx: 'remote-logout-purge' });
    }
    await this.deleteSessionRow();
    this.currentPhoneNumber = undefined;
    this.currentPushName = undefined;
    this.currentError = 'Logged out from WhatsApp. Scan the QR code again to link.';
    this.currentQrDataUrl = undefined;
  }

  /**
   * After a transient drop, restart the engine if a completed link is stored.
   * Never starts a fresh QR on its own.
   */
  private async recoverLinkedSession(): Promise<void> {
    if (this.stopping || this._paused || this.initializing) return;
    const registered = await hasRegisteredWhatsAppCreds(this.pool, this.dek);
    const row = await this.readSessionRow();
    if (!registered && !row?.phone_number) return;
    getLogger().info('WHATSAPP', 'Linked session dropped — reconnecting without QR');
    try {
      await this.link();
    } catch (err) {
      getLogger().warn('WHATSAPP', `Linked-session recover failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ─── Internal: DB helpers ───────────────────────────────────────────────

  private async readSessionRow(): Promise<SessionRow | null> {
    try {
      const { rows } = await this.pool.query(
        'SELECT * FROM whatsapp_session WHERE id = $1',
        [SESSION_ID],
      );
      return (rows[0] as SessionRow) ?? null;
    } catch (err) {
      getLogger().warn('WHATSAPP', `Failed to read session row: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private async upsertSessionRow(
    status: EngineStatus,
    extra?: { phoneNumber?: string; pushName?: string; lastError?: string; connectedAt?: Date },
  ): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO whatsapp_session (id, status, engine, phone_number, push_name, last_error, connected_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           phone_number = COALESCE(EXCLUDED.phone_number, whatsapp_session.phone_number),
           push_name = COALESCE(EXCLUDED.push_name, whatsapp_session.push_name),
           last_error = EXCLUDED.last_error,
           connected_at = COALESCE(EXCLUDED.connected_at, whatsapp_session.connected_at),
           updated_at = NOW()`,
        [
          SESSION_ID,
          status,
          this.engineKind,
          extra?.phoneNumber ?? null,
          extra?.pushName ?? null,
          extra?.lastError ?? null,
          extra?.connectedAt ?? null,
        ],
      );
    } catch (err) {
      getLogger().warn('WHATSAPP', `Failed to upsert session row: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async deleteSessionRow(): Promise<void> {
    try {
      await this.pool.query('DELETE FROM whatsapp_session WHERE id = $1', [SESSION_ID]);
    } catch (err) {
      getLogger().warn('WHATSAPP', `Failed to delete session row: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async touchLastActive(): Promise<void> {
    try {
      await this.pool.query(
        'UPDATE whatsapp_session SET last_active_at = NOW(), updated_at = NOW() WHERE id = $1',
        [SESSION_ID],
      );
    } catch {
      // best-effort — don't log on every message
    }
  }

  // ─── Internal: timeout helper ───────────────────────────────────────────

  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`WhatsAppSessionService: ${label} timed out after ${ms}ms`)), ms),
      ),
    ]);
  }
}
