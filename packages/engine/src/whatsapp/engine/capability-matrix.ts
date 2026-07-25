/**
 * Capability matrix — declarative record of which WhatsApp engine supports
 * which **extended** capability, per §2.6 of WHATSAPP_INTEGRATION_PLAN.md.
 *
 * Core messaging capabilities (text, image, video, audio, document, location,
 * contact, poll, sticker, reply, forward, react, edit, delete) are guaranteed
 * by the `IWhatsAppEngine` interface contract — both engines implement all of
 * them — so they are NOT listed here. This matrix only tracks capabilities
 * that **differ** between engines and may trigger a fallback.
 *
 * Used by:
 *   - `WhatsAppSessionService` (Phase 3) to decide whether to fall back to
 *     the secondary engine when the primary lacks a needed capability.
 *   - The agent tool surface (Phase 6) to surface capability availability.
 *
 * `BaileysEngine` is the primary (§0.1); `ElectronWebJsEngine` is the fallback.
 */
import type { EngineCapability } from './IWhatsAppEngine.js';
import type { WhatsAppEngineKind } from './EngineFactory.js';

/**
 * For each extended capability, list the engines that support it, in priority
 * order. The first engine in the list is the preferred provider.
 */
export const CAPABILITY_MATRIX: Record<EngineCapability, WhatsAppEngineKind[]> = {
  // Call rejection — Baileys handles this fully; wwebjs's rejectCall is a no-op.
  rejectCall: ['baileys'],

  // Group management — Baileys implements all methods; wwebjs adapter doesn't
  // wire them up yet (returns NOT_SUPPORTED from the method-existence guard).
  groupManagement: ['baileys'],

  // Message history & reactions — Baileys tracks these in-memory from events
  // (full history sync is disabled per §0.7). wwebjs adapter not yet wired.
  chatHistoryFetch: ['baileys'],
  messageReactionsQuery: ['baileys'],

  // Status stories — Baileys can post to status@broadcast. wwebjs not yet wired.
  statusStories: ['baileys'],

  // Channels (newsletters) — Baileys supports follow/metadata. wwebjs not yet wired.
  channels: ['baileys'],

  // Labels & catalog — WhatsApp Business API feature. Neither engine adapter
  // implements the methods yet; tools return CAPABILITY_NOT_SUPPORTED.
  labels: [],
  catalog: [],
};

/**
 * Check whether a given engine kind supports a given extended capability.
 */
export function engineSupportsCapability(engine: WhatsAppEngineKind, capability: EngineCapability): boolean {
  return CAPABILITY_MATRIX[capability]?.includes(engine) ?? false;
}

/**
 * Get the preferred engine kind for a given capability (first in the priority
 * list), or `null` if no engine supports it.
 */
export function preferredEngineForCapability(capability: EngineCapability): WhatsAppEngineKind | null {
  return CAPABILITY_MATRIX[capability]?.[0] ?? null;
}
