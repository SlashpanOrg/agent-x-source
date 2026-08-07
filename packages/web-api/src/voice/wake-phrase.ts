export const WAKE_WORD_IDLE_MS = 10_000;

const WAKE_ACK_TEMPLATES = [
  'Yes, {{callsign}}?',
  'At your service, {{callsign}}.',
  'I am listening, {{callsign}}.',
  'Awaiting your command, {{callsign}}.',
  'How may I assist you, {{callsign}}?',
  'Your command, {{callsign}}?',
  'I am ready, {{callsign}}.',
  'As you wish, {{callsign}}.',
  'Yes, {{callsign}}.',
  'Listening, {{callsign}}.',
  'At your command, {{callsign}}.',
  'Go ahead, {{callsign}}.',
  'I am here, {{callsign}}.',
  'Ready, {{callsign}}.',
  'Standing by, {{callsign}}.',
];

export function pickWakeAck(callsign?: string): string {
  const name = (callsign?.trim() || 'sir').replace(/[<>"]/g, '');
  const template = WAKE_ACK_TEMPLATES[Math.floor(Math.random() * WAKE_ACK_TEMPLATES.length)]!;
  return template.replace(/\{\{callsign\}\}/g, name);
}

export function normalizeWakePhrase(phrase: string): string {
  return phrase
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTranscriptText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isInWakeIdle(idleUntil: number): boolean {
  return idleUntil > 0 && Date.now() < idleUntil;
}

export function tryStripWakePhrase(
  text: string,
  phrase: string,
): { startsWith: boolean; stripped: string } {
  const normalizedPhrase = normalizeWakePhrase(phrase);
  const normalizedText = normalizeTranscriptText(text);
  if (!normalizedPhrase) {
    return { startsWith: false, stripped: text };
  }

  if (normalizedText === normalizedPhrase) {
    return { startsWith: true, stripped: '' };
  }

  if (normalizedText.startsWith(normalizedPhrase + ' ')) {
    const wordCount = normalizedPhrase.split(' ').length;
    const words = text.trim().split(/\s+/);
    const stripped = words.slice(wordCount).join(' ');
    return { startsWith: true, stripped };
  }

  return { startsWith: false, stripped: text };
}
