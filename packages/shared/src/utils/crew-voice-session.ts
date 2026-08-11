/** Prefixed session id for a crew private-call transcript (sibling of the text chat). */
export const CREW_VOICE_SESSION_PREFIX = 'voice:';

/**
 * Synthetic text-session anchor used when a call starts before any private chat exists.
 * Produces `voice:call:{crewId}` — no empty crew_private text row is created.
 */
export const CREW_CALL_ANCHOR_PREFIX = 'call:';

/** Voice session id derived from the lifelong private text session (or call-only anchor). */
export function crewVoiceSessionId(textSessionId: string): string {
  const trimmed = textSessionId.trim();
  if (!trimmed) throw new Error('text-session-id-required');
  if (isCrewVoiceSessionId(trimmed)) return trimmed;
  return `${CREW_VOICE_SESSION_PREFIX}${trimmed}`;
}

export function isCrewVoiceSessionId(id: string): boolean {
  return id.startsWith(CREW_VOICE_SESSION_PREFIX);
}

/** Stable call-only anchor for a crew (not a real text session row). */
export function crewCallAnchorId(crewId: string): string {
  const id = crewId.trim();
  if (!id) throw new Error('crew-id-required');
  if (isCrewCallAnchorId(id)) return id;
  return `${CREW_CALL_ANCHOR_PREFIX}${id}`;
}

export function isCrewCallAnchorId(id: string): boolean {
  return id.startsWith(CREW_CALL_ANCHOR_PREFIX);
}

/** Text private-chat session id linked to a voice call session, or null. */
export function textSessionIdFromVoiceSessionId(sessionId: string): string | null {
  if (!isCrewVoiceSessionId(sessionId)) return null;
  const textId = sessionId.slice(CREW_VOICE_SESSION_PREFIX.length).trim();
  return textId || null;
}
