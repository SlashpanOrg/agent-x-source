import type { ChannelBindingId } from './channel-session-binding.js';
import { textSessionIdFromVoiceSessionId } from './crew-voice-session.js';

/** Prefix for all messaging-channel transcript sessions. */
export const CHANNEL_SESSION_ID = '__channel__';

const CHANNEL_SESSION_PREFIX = `${CHANNEL_SESSION_ID}:`;

const CHANNEL_BINDINGS: readonly ChannelBindingId[] = ['telegram', 'slack', 'discord', 'email', 'whatsapp', 'voice'];

/** Per-surface transcript session id, e.g. __channel__:telegram */
export function channelSessionIdForBinding(channel: ChannelBindingId): string {
  return `${CHANNEL_SESSION_PREFIX}${channel}`;
}

/**
 * Per-contact transcript session id for channels that route per-sender
 * (WhatsApp). Format: `__channel__:whatsapp:<senderJid>`.
 * Each contact gets an isolated conversation history.
 */
export function channelSessionIdForContact(channel: ChannelBindingId, senderId: string): string {
  return `${CHANNEL_SESSION_PREFIX}${channel}:${senderId}`;
}

/** Parse channel from a channel session id; legacy __channel__ maps to telegram. */
export function parseChannelBindingFromSessionId(
  sessionId: string | null | undefined,
): ChannelBindingId | null {
  if (!sessionId) return null;
  if (sessionId === CHANNEL_SESSION_ID) return 'telegram';
  if (!sessionId.startsWith(CHANNEL_SESSION_PREFIX)) return null;
  // Strip per-contact suffix if present: __channel__:whatsapp:91701...@s.whatsapp.net
  const suffix = sessionId.slice(CHANNEL_SESSION_PREFIX.length);
  const colonIdx = suffix.indexOf(':');
  const channel = colonIdx >= 0 ? suffix.slice(0, colonIdx) : suffix;
  return CHANNEL_BINDINGS.includes(channel as ChannelBindingId) ? (channel as ChannelBindingId) : null;
}

export function isChannelSessionId(sessionId: string | null | undefined): boolean {
  if (!sessionId) return false;
  if (sessionId === CHANNEL_SESSION_ID) return true;
  return sessionId.startsWith(CHANNEL_SESSION_PREFIX);
}

/**
 * Extract the per-contact sender ID from a channel session id, if present.
 * Returns null for shared channel sessions (no per-contact suffix).
 * Example: `__channel__:whatsapp:91701...@s.whatsapp.net` → `91701...@s.whatsapp.net`
 */
export function contactIdFromChannelSessionId(sessionId: string | null | undefined): string | null {
  if (!sessionId || !sessionId.startsWith(CHANNEL_SESSION_PREFIX)) return null;
  const suffix = sessionId.slice(CHANNEL_SESSION_PREFIX.length);
  const colonIdx = suffix.indexOf(':');
  if (colonIdx < 0) return null; // No per-contact suffix
  return suffix.slice(colonIdx + 1);
}

/** Messaging channels operate as fleet-wide operator consoles (super sessions). Voice is a segregated session, not a super session. */
export function isSuperSessionId(sessionId: string | null | undefined): boolean {
  if (!isChannelSessionId(sessionId)) return false;
  const channel = parseChannelBindingFromSessionId(sessionId);
  return channel !== 'voice';
}

/** When a super session calls fleet tools, omit session filter so all resources are visible. */
export function resolveFleetToolSessionScope(sessionId: string): string | undefined {
  return isSuperSessionId(sessionId) ? undefined : sessionId;
}

/**
 * Session filter for automation list/cancel/register.
 * - Super sessions (Telegram/Slack/…) → undefined (fleet-wide).
 * - Crew voice calls (`voice:{textId}`) → parent text session so call + chat share tasks.
 * - Everything else → the session itself.
 */
export function resolveAutomationSessionScope(sessionId: string): string | undefined {
  if (isSuperSessionId(sessionId)) return undefined;
  const textId = textSessionIdFromVoiceSessionId(sessionId);
  if (textId) return textId;
  return sessionId;
}
