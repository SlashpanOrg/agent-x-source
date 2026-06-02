import { describe, it, expect, vi } from 'vitest';
import { FailoverPolicy } from '../src/communication/FailoverPolicy.js';
import { AuthProfileManager } from '../src/providers/AuthProfileManager.js';
import { FailoverReason } from '@agentx/shared';

describe('FailoverPolicy', () => {
  const profiles = new AuthProfileManager();
  profiles.addCredential('openai', 'key-1');
  profiles.addCredential('openai', 'key-2');
  const policy = new FailoverPolicy(profiles);

  it('returns compact_and_retry for context overflow', () => {
    const result = policy.decide(
      { reason: FailoverReason.CONTEXT_OVERFLOW, retryable: true, shouldCompress: true, shouldRotateCredential: false, shouldFallback: false },
      1, 'openai',
    );
    expect(result.type).toBe('compact_and_retry');
  });

  it('returns rotate_profile_and_retry for auth error', () => {
    const result = policy.decide(
      { reason: FailoverReason.AUTH, retryable: true, shouldCompress: false, shouldRotateCredential: true, shouldFallback: false },
      1, 'openai',
    );
    expect(result.type).toBe('rotate_profile_and_retry');
  });

  it('returns fallback_model_and_retry for server error', () => {
    const result = policy.decide(
      { reason: FailoverReason.SERVER_ERROR, retryable: true, shouldCompress: false, shouldRotateCredential: false, shouldFallback: true },
      1, 'openai',
    );
    expect(result.type).toBe('fallback_model_and_retry');
  });

  it('returns inject_retry_instruction for format error on first attempt', () => {
    const result = policy.decide(
      { reason: FailoverReason.FORMAT, retryable: true, shouldCompress: false, shouldRotateCredential: false, shouldFallback: false },
      1, 'openai',
    );
    expect(result.type).toBe('inject_retry_instruction');
  });

  it('returns surface_error when no recovery possible', () => {
    const result = policy.decide(
      { reason: FailoverReason.UNKNOWN, retryable: false, shouldCompress: false, shouldRotateCredential: false, shouldFallback: false },
      3, 'openai',
    );
    expect(result.type).toBe('surface_error');
  });

  it('returns surface_error when no rotate possible for auth', () => {
    const noProfiles = new AuthProfileManager();
    const p = new FailoverPolicy(noProfiles);
    const result = p.decide(
      { reason: FailoverReason.AUTH, retryable: true, shouldCompress: false, shouldRotateCredential: true, shouldFallback: false },
      1, 'unknown-provider',
    );
    expect(result.type).toBe('surface_error');
  });
});
