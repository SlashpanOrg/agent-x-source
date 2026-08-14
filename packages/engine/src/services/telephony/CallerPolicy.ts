import type { TelephonyConfig } from '@agentx/shared';
import { hashE164, normalizeE164 } from './phone-redaction.js';
import { getVoiceCallStore, type VoiceCallStore } from './VoiceCallStore.js';

export type CallerPolicyDecision = 'allow' | 'block' | 'unknown';

export interface CallerPolicyResult {
  decision: CallerPolicyDecision;
  reason:
    | 'caller_opted_out'
    | 'blocklisted'
    | 'allowlisted'
    | 'no_policy_match';
  optedOut: boolean;
  allowlisted: boolean;
  blocklisted: boolean;
}

export interface CallerPolicyOptions {
  store?: VoiceCallStore;
  /** E.164 numbers always allowed (bypasses "unknown caller" handling). */
  allowlist?: string[];
  /** E.164 numbers always rejected before any mission loads. */
  blocklist?: string[];
}

/**
 * Resolves an inbound caller to allow/block/unknown using, in priority order:
 * 1. Opt-out / do-not-call consent records (always wins — safety-critical).
 * 2. Explicit blocklist.
 * 3. Explicit allowlist.
 * 4. Unknown — caller policy in HOST_VOICE_ACCESS_PLAN §6.1 then applies
 *    (limited greeting, verification request, etc.) at the caller.
 */
export class CallerPolicy {
  private readonly store: VoiceCallStore;
  private readonly allowlist: Set<string>;
  private readonly blocklist: Set<string>;

  constructor(options: CallerPolicyOptions = {}) {
    this.store = options.store ?? getVoiceCallStore();
    this.allowlist = new Set((options.allowlist ?? []).map(normalizeE164).filter(Boolean));
    this.blocklist = new Set((options.blocklist ?? []).map(normalizeE164).filter(Boolean));
  }

  static fromConfig(config: TelephonyConfig, store?: VoiceCallStore): CallerPolicy {
    return new CallerPolicy({
      store,
      allowlist: config.callerAllowlist,
      blocklist: config.callerBlocklist,
    });
  }

  async resolve(callerE164: string): Promise<CallerPolicyResult> {
    const normalized = normalizeE164(callerE164);
    const hash = hashE164(callerE164);

    if (await this.store.isOptedOut(hash)) {
      return {
        decision: 'block',
        reason: 'caller_opted_out',
        optedOut: true,
        allowlisted: false,
        blocklisted: false,
      };
    }
    if (this.blocklist.has(normalized)) {
      return {
        decision: 'block',
        reason: 'blocklisted',
        optedOut: false,
        allowlisted: false,
        blocklisted: true,
      };
    }
    if (this.allowlist.has(normalized)) {
      return {
        decision: 'allow',
        reason: 'allowlisted',
        optedOut: false,
        allowlisted: true,
        blocklisted: false,
      };
    }
    return {
      decision: 'unknown',
      reason: 'no_policy_match',
      optedOut: false,
      allowlisted: false,
      blocklisted: false,
    };
  }
}
