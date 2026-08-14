/** Prefix on every Agent-X message in the owner's WhatsApp self-chat. */
export const AGENT_X_WHATSAPP_MARKER = '[Agent-X]';

/** Coalesce world briefs from the same sender (ms). */
export const WORLD_BRIEF_COALESCE_MS = 60_000;

/** At most one spoken voice interrupt per sender in this window. */
export const VOICE_ANNOUNCE_DEBOUNCE_MS = 120_000;

export function isAgentMarkedBody(body: string | undefined | null): boolean {
  const text = (body ?? '').trim();
  return text.startsWith(AGENT_X_WHATSAPP_MARKER);
}

export function formatAgentSelfChat(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return AGENT_X_WHATSAPP_MARKER;
  if (trimmed.startsWith(AGENT_X_WHATSAPP_MARKER)) return trimmed;
  return `${AGENT_X_WHATSAPP_MARKER}\n${trimmed}`;
}
