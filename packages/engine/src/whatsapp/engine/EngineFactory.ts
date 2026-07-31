/**
 * EngineFactory — constructs the active WhatsApp engine for the single session.
 *
 * Per §0.1 of WHATSAPP_INTEGRATION_PLAN.md, the selection policy is
 * **Baileys-first**: `BaileysEngine` is the primary engine and is always
 * attempted first. `ElectronWebJsEngine` (Phase 2.4) is only instantiated when
 * Baileys is explicitly configured as the fallback, or when Baileys fails to
 * initialize repeatedly and the session service requests a fallback.
 *
 * Single-session scope (Ground Rule 7): the factory produces one engine
 * instance at a time; there is no per-session keying.
 */
import type { Pool } from 'pg';
import type { IWhatsAppEngine } from './IWhatsAppEngine.js';
import { BaileysEngine, type BaileysEngineOptions } from './BaileysEngine.js';
import { ElectronWebJsEngine, type ElectronWebJsEngineOptions } from './ElectronWebJsEngine.js';

export type WhatsAppEngineKind = 'baileys' | 'electron-wwebjs';

export interface EngineFactoryOptions {
  pool: Pool;
  dek: Buffer;
  /** Which engine to construct. Defaults to `'baileys'` (§0.1 policy). */
  engine?: WhatsAppEngineKind;
  /** Forwarded to BaileysEngine when constructing a Baileys engine. */
  baileys?: Omit<BaileysEngineOptions, 'pool' | 'dek'>;
  /** Forwarded to ElectronWebJsEngine when constructing the fallback engine. */
  electronWwebJs?: Omit<ElectronWebJsEngineOptions, never>;
}

/**
 * Construct a WhatsApp engine instance. The caller (WhatsAppSessionService,
 * Phase 3) owns the returned instance and is responsible for calling
 * `setCallbacks()` / `initialize()` / `disconnect()` on it.
 */
export function createWhatsAppEngine(opts: EngineFactoryOptions): IWhatsAppEngine {
  const kind = opts.engine ?? 'baileys';

  if (kind === 'baileys') {
    return new BaileysEngine({
      pool: opts.pool,
      dek: opts.dek,
      ...opts.baileys,
    });
  }

  if (kind === 'electron-wwebjs') {
    if (!opts.electronWwebJs?.cdpEndpoint) {
      throw new Error(
        "EngineFactory: engine 'electron-wwebjs' requires `electronWwebJs.cdpEndpoint` " +
        '(the CDP URL of Electron\'s own Chromium, e.g. http://127.0.0.1:9222)',
      );
    }
    return new ElectronWebJsEngine(opts.electronWwebJs);
  }

  throw new Error(`EngineFactory: unknown engine kind '${kind}'`);
}
