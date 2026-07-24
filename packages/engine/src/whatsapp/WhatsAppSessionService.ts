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
import type { Pool } from 'pg';
import { getLogger } from '@agentx/shared';

import { WhatsAppEventBus } from './WhatsAppEventBus.js';
import { purgeWhatsAppAuthState, type SessionRow } from './WhatsAppStore.js';
import { createWhatsAppEngine, type WhatsAppEngineKind } from './engine/EngineFactory.js';
import { EngineStatus } from './engine/IWhatsAppEngine.js';
import type {
  IWhatsAppEngine,
  WhatsAppEngineCallbacks,
} from './engine/IWhatsAppEngine.js';

/** Single-row id for the whatsapp_session table. */
const SESSION_ID = 'default';

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

  /**
   * Runtime allowlist of WhatsApp JIDs that the agent should auto-reply to,
   * even if they're not in the user's saved contacts. Populated by the
   * whatsapp_allow_sender tool when the user explicitly approves a number.
   */
  private readonly runtimeAllowedJids = new Set<string>();
  /**
   * Runtime blocklist of WhatsApp JIDs that should never get auto-replies.
   * Populated by the whatsapp_block_sender tool.
   */
  private readonly runtimeBlockedJids = new Set<string>();

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

  // ─── Inbound allowlist management ──────────────────────────────────────

  /** Add a JID to the runtime allowlist (agent will auto-reply to this sender). */
  allowSender(jid: string): void {
    this.runtimeAllowedJids.add(jid);
    this.runtimeBlockedJids.delete(jid);
  }

  /** Add a JID to the runtime blocklist (agent will silently drop messages). */
  blockSender(jid: string): void {
    this.runtimeBlockedJids.add(jid);
    this.runtimeAllowedJids.delete(jid);
  }

  /** Remove a JID from both the allowlist and blocklist. */
  removeSenderRestriction(jid: string): void {
    this.runtimeAllowedJids.delete(jid);
    this.runtimeBlockedJids.delete(jid);
  }

  /** Check if a JID is explicitly allowed (via whatsapp_allow_sender tool). */
  isRuntimeAllowed(jid: string): boolean {
    return this.runtimeAllowedJids.has(jid);
  }

  /** Check if a JID is explicitly blocked (via whatsapp_block_sender tool). */
  isRuntimeBlocked(jid: string): boolean {
    return this.runtimeBlockedJids.has(jid);
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
    // Idempotent: if the engine is already active (e.g. from reconcileOnBoot
    // auto-reconnecting), don't throw — just return. The caller can check
    // getStatus() to see the current state and getQr() for the QR code.
    if (this.engine) {
      return;
    }
    if (this.initializing) {
      // Another link() is in progress — wait briefly then return
      return;
    }
    this.initializing = true;
    this.stopping = false;
    this.currentError = undefined;
    this.currentQrDataUrl = undefined;

    // Purge stale credentials from any previous failed/partial link attempt.
    // If a previous QR scan failed mid-handshake, Baileys may have written
    // partial creds to the DB. On the next link(), loadOrInit() would load
    // these stale creds and Baileys would think it's "registered" — causing
    // the handshake to fail with "Check your connection" on the phone.
    // Only skip purge if we have a confirmed READY session in the DB.
    const existingRow = await this.readSessionRow();
    if (existingRow && existingRow.status !== EngineStatus.READY) {
      getLogger().info('WHATSAPP', `link(): purging stale credentials (previous status: ${existingRow.status})`);
      try {
        await purgeWhatsAppAuthState(this.pool, this.dek);
      } catch (err) {
        getLogger().warn('WHATSAPP', `link(): stale credential purge failed: ${err instanceof Error ? err.message : String(err)}`);
      }
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
   * Unlink — delete all credentials and session data. The engine must be
   * stopped first (or this will stop it).
   */
  async unlink(): Promise<void> {
    await this.stop();
    try {
      await purgeWhatsAppAuthState(this.pool, this.dek);
    } catch (err) {
      getLogger().error('WHATSAPP', err instanceof Error ? err : new Error(String(err)), { ctx: 'unlink-purge' });
    }
    await this.deleteSessionRow();
    this.currentPhoneNumber = undefined;
    this.currentPushName = undefined;
    this.currentError = undefined;
    this.currentQrDataUrl = undefined;
    this.eventBus.clear();
  }

  /**
   * Boot-time reconciliation (§3.4). Call once on app startup.
   * - If the session was left in "initializing" or "qr_ready", reset to "disconnected".
   * - If the session was previously authenticated (status was "ready"), auto-restart.
   */
  async reconcileOnBoot(): Promise<void> {
    const row = await this.readSessionRow();
    if (!row) {
      // No session record — nothing to reconcile.
      return;
    }

    const staleStates: EngineStatus[] = [EngineStatus.INITIALIZING, EngineStatus.QR_READY, EngineStatus.PAIRING, EngineStatus.AUTHENTICATING];
    if (staleStates.includes(row.status as EngineStatus)) {
      getLogger().info('WHATSAPP', `Reconciling stale session state '${row.status}' → 'disconnected'`);
      await this.upsertSessionRow(EngineStatus.DISCONNECTED);
      return;
    }

    if (row.status === EngineStatus.READY) {
      getLogger().info('WHATSAPP', 'Previously authenticated session found — auto-restarting engine');
      try {
        await this.link();
        // Connection succeeded — ensure we're not paused
        this._paused = false;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        getLogger().warn('WHATSAPP', `Auto-restart failed: ${errMsg} — entering paused state`);
        await this.upsertSessionRow(EngineStatus.DISCONNECTED, {
          lastError: `Auto-restart failed: ${errMsg}`,
        });
        // Auto-pause: the engine couldn't connect, likely due to a protocol
        // break or library incompatibility. The UI will show a retry button.
        this._paused = true;
      }
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
      },
      onMessage: (msg) => {
        this.eventBus.emit('message', msg);
        void this.touchLastActive();
      },
      onMessageSent: (msg) => {
        this.eventBus.emit('messageSent', msg);
        void this.touchLastActive();
      },
      onMessageAck: (ack) => this.eventBus.emit('messageAck', ack),
      onMessageRevoked: (chatId, messageId) => this.eventBus.emit('messageRevoked', chatId, messageId),
      onMessageReaction: (chatId, messageId, senderId, emoji) =>
        this.eventBus.emit('messageReaction', chatId, messageId, senderId, emoji),
      onMessageEdited: (msg) => this.eventBus.emit('messageEdited', msg),
      onGroupEvent: (event) => this.eventBus.emit('groupEvent', event),
      onCallReceived: (call) => this.eventBus.emit('callReceived', call),
      onDisconnected: (reason) => {
        this.eventBus.emit('disconnected', reason);
        void this.upsertSessionRow(EngineStatus.DISCONNECTED);
      },
      onError: (error) => {
        this.currentError = error.message;
        this.eventBus.emit('error', error);
        void this.upsertSessionRow(this.engine?.getStatus() ?? EngineStatus.FAILED, { lastError: error.message });
      },
    };
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
