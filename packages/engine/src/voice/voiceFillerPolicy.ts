/** Pool of short butler-style acknowledgment templates for the instant voice ack
 *  filler. {{callsign}} is replaced by the user's configured callsign. Each turn
 *  picks one at random, avoiding the last few picks so the same phrase doesn't
 *  repeat near itself. */
export const BUTLER_ACK_TEMPLATES = [
  'Yes, {{callsign}}.',
  'At your service, {{callsign}}.',
  'I am listening, {{callsign}}.',
  'Awaiting your command, {{callsign}}.',
  'How may I assist you, {{callsign}}?',
  'Your command, {{callsign}}?',
  'I am ready, {{callsign}}.',
  'As you wish, {{callsign}}.',
  'Yes, {{callsign}}?',
  'Listening, {{callsign}}.',
  'At your command, {{callsign}}.',
  'Go ahead, {{callsign}}.',
  'I am here, {{callsign}}.',
  'Ready, {{callsign}}.',
  'Standing by, {{callsign}}.',
];

const ACK_HISTORY_SIZE = 5;
const ackHistory: string[] = [];

/** Pick a random ack phrase, avoiding the last few picks for variety. */
export function pickAckPhrase(callsign = 'sir'): string {
  if (BUTLER_ACK_TEMPLATES.length <= ACK_HISTORY_SIZE) {
    // Pool too small for meaningful dedup — just pick randomly.
    const template = BUTLER_ACK_TEMPLATES[Math.floor(Math.random() * BUTLER_ACK_TEMPLATES.length)]!;
    return template.replace(/\{\{callsign\}\}/g, callsign.replace(/[<>"]/g, ''));
  }
  const available = BUTLER_ACK_TEMPLATES.filter((p) => !ackHistory.includes(p));
  const pick = available[Math.floor(Math.random() * available.length)]!;
  ackHistory.push(pick);
  if (ackHistory.length > ACK_HISTORY_SIZE) ackHistory.shift();
  return pick.replace(/\{\{callsign\}\}/g, callsign.replace(/[<>"]/g, ''));
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
