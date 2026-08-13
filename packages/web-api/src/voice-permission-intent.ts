/**
 * Classify a spoken utterance as a voice-tool permission decision.
 *
 * No strict keyword requirement: short natural yes/no language is enough.
 * Returns null when the utterance is ambiguous so the caller can clarify
 * (never default to allow on unclear speech).
 */
export type VoicePermissionIntent = 'allow_once' | 'deny';

const ALLOW_EXACT = /^(yes|yeah|yep|yup|yah|ya|sure|ok|okay|alright|all right|fine|absolutely|definitely|please|please do|do it|do that|go ahead|go for it|proceed|continue|confirm|confirmed|approved|approve|allow|allowed|sounds good|that's fine|thats fine|that is fine|looks good|make it so|go on|mmhmm|mm hmm|uh huh|uh-huh)([,]?\s+(please|thanks|thank you|do that|go ahead|go for it))?$/i;

const ALLOW_LOOSE = [
  /\b(yes|yeah|yep|yup|sure|okay|ok|alright)\b/,
  /\bgo ahead\b/,
  /\bgo for it\b/,
  /\bdo it\b/,
  /\bdo that\b/,
  /\bplease do\b/,
  /\bsounds good\b/,
  /\bthat'?s fine\b/,
  /\blooks good\b/,
  /\bmake it so\b/,
  /\bproceed\b/,
  /\ballow(ed)?\b/,
  /\bapprove(d)?\b/,
  /\bconfirm(ed)?\b/,
];

const DENY_EXACT = /^(no|nope|nah|no thanks|no thank you|don't|dont|do not|stop|skip|cancel|never|hold on|hold off|not now|not yet|wait|deny|denied|reject|rejected)$/i;

const DENY_LOOSE = [
  /\b(no|nope|nah)\b/,
  /\bden(y|ied)\b/,
  /\breject(ed)?\b/,
  /\bcancel\b/,
  /\bskip\b/,
  /\bstop\b/,
  /\bdon'?t\b/,
  /\bdo not\b/,
  /\bnever\b/,
  /\bnot now\b/,
  /\bnot yet\b/,
  /\bi'?d rather not\b/,
  /\bhold off\b/,
  /\bhold on\b/,
];

function normalizeUtterance(raw: string): string {
  return raw.toLowerCase().trim().replace(/[.!?,]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function wordCount(text: string): number {
  return text ? text.split(/\s+/).length : 0;
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

/**
 * Classify spoken permission. Long off-topic replies are treated as unclear
 * unless they clearly contain only an allow or deny intent.
 */
export function classifyVoicePermissionUtterance(raw: string): VoicePermissionIntent | null {
  const text = normalizeUtterance(raw);
  if (!text) return null;

  if (ALLOW_EXACT.test(text)) return 'allow_once';
  if (DENY_EXACT.test(text)) return 'deny';

  const wantsAllow = matchesAny(text, ALLOW_LOOSE);
  const wantsDeny = matchesAny(text, DENY_LOOSE);

  if (wantsAllow && wantsDeny) {
    // "no, go ahead" / "don't — wait, yes" — prefer deny unless a clear proceed follows the no.
    if (/\b(go ahead|do it|proceed|yes)\b/.test(text) && !/\b(don'?t|do not|never)\b/.test(text)) {
      return 'allow_once';
    }
    return 'deny';
  }

  if (wantsAllow) {
    // A long new request that happens to include "ok" is not confirmation.
    if (wordCount(text) > 12) return null;
    return 'allow_once';
  }
  if (wantsDeny) return 'deny';

  return null;
}

/** @deprecated Use classifyVoicePermissionUtterance — always/approve-all map to a one-shot allow. */
export function parseVoicePermissionIntent(raw: string): VoicePermissionIntent | 'allow_always' | 'approve_all' | null {
  return classifyVoicePermissionUtterance(raw);
}
