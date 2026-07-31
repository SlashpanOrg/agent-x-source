/** Pool of short acknowledgment phrases for the instant voice ack filler.
 *  Each turn picks one at random, avoiding the last few picks so the same
 *  phrase doesn't repeat near itself. */
export const VOICE_ACK_PHRASES = [
  'Got it.',
  'On it.',
  'Understood.',
  'Right away.',
  'Let me check.',
  'Looking into that.',
  'Sure thing.',
  'Coming right up.',
  'One moment.',
  'I\'m on it.',
  'Noted.',
  'Will do.',
  'Absolutely.',
  'Of course.',
  'Let me see.',
  'Checking now.',
  'Sounds good.',
  'You got it.',
  'Makes sense.',
  'Let\'s do it.',
];

const ACK_HISTORY_SIZE = 5;
const ackHistory: string[] = [];

/** Pick a random ack phrase, avoiding the last few picks for variety. */
export function pickAckPhrase(): string {
  if (VOICE_ACK_PHRASES.length <= ACK_HISTORY_SIZE) {
    // Pool too small for meaningful dedup — just pick randomly.
    return VOICE_ACK_PHRASES[Math.floor(Math.random() * VOICE_ACK_PHRASES.length)]!;
  }
  const available = VOICE_ACK_PHRASES.filter((p) => !ackHistory.includes(p));
  const pick = available[Math.floor(Math.random() * available.length)]!;
  ackHistory.push(pick);
  if (ackHistory.length > ACK_HISTORY_SIZE) ackHistory.shift();
  return pick;
}

/** Reset ack history (e.g. on new session). */
export function resetAckHistory(): void {
  ackHistory.length = 0;
}

/** Heuristic: skip instant "Got it" ack for greetings, mic checks, and light chat. */
export function shouldSpeakVoiceAckFiller(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase().replace(/[^\w\s'?]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;

  if (/^(hi|hello|hey|hiya|good morning|good evening|good afternoon|yo|sup|howdy|greetings)\b/.test(normalized)) {
    return false;
  }

  if (/\b(can you hear me|are you there|you there|testing|test test|mic check|audio check|do you hear me|is this working|hello there)\b/.test(normalized)) {
    return false;
  }

  if (/^(thanks|thank you|ok|okay|cool|great|nice|perfect|got it|bye|goodbye|see you|good night)\b/.test(normalized)) {
    return false;
  }

  const words = normalized.split(/\s+/);
  const actionIntent = /\b(search|find|create|build|write|run|execute|deploy|install|download|analyze|analyse|research|schedule|remind|send|delete|update|fix|help me|look up|what is|how do|explain|summarize|summarise|compare|list|generate|make me|tell me about|show me)\b/;
  if (words.length <= 10 && !actionIntent.test(normalized)) {
    return false;
  }

  return true;
}
