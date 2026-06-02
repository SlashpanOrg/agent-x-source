import type { ClassifiedError, RetryAction } from '@agentx/shared';
import { FailoverReason } from '@agentx/shared';
import type { AuthProfileManager } from '../providers/AuthProfileManager.js';

export class FailoverPolicy {
  constructor(private authProfiles: AuthProfileManager) {}

  decide(error: ClassifiedError, attempt: number, providerId: string): RetryAction {
    if (
      error.reason === FailoverReason.CONTEXT_OVERFLOW &&
      attempt < 3
    ) {
      return { type: 'compact_and_retry' };
    }

    if (
      (error.reason === FailoverReason.AUTH ||
        error.reason === FailoverReason.BILLING ||
        error.reason === FailoverReason.RATE_LIMIT) &&
      this.authProfiles.canRotate(providerId)
    ) {
      return { type: 'rotate_profile_and_retry' };
    }

    if (
      error.shouldFallback &&
      (error.reason === FailoverReason.SERVER_ERROR ||
        error.reason === FailoverReason.OVERLOADED ||
        error.reason === FailoverReason.TIMEOUT ||
        error.reason === FailoverReason.MODEL_NOT_FOUND ||
        error.reason === FailoverReason.POLICY_BLOCK)
    ) {
      return { type: 'fallback_model_and_retry' };
    }

    if (
      error.reason === FailoverReason.FORMAT &&
      attempt < 2
    ) {
      return {
        type: 'inject_retry_instruction',
        instruction:
          'Please provide a valid response. Your previous response was empty or malformed.',
      };
    }

    return {
      type: 'surface_error',
      message: `Provider error: ${error.providerMessage ?? error.reason}`,
    };
  }
}
