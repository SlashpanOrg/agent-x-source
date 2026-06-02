import type { RetryAction } from '@agentx/shared';
import { ErrorClassifier } from './ErrorClassifier.js';
import { FailoverPolicy } from './FailoverPolicy.js';
import { RetryStatusBuffer } from './RetryStatusBuffer.js';
import { IdleTimeoutBreaker } from './IdleTimeoutBreaker.js';
import { StaleWatchdog } from './StaleWatchdog.js';
import type { AuthProfileManager } from '../providers/AuthProfileManager.js';

export interface RetryEngineConfig {
  maxRetries: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  providerId: string;
}

export class RetryEngine {
  private classifier = new ErrorClassifier();
  private failover: FailoverPolicy;
  private statusBuffer = new RetryStatusBuffer();
  private idleBreaker = new IdleTimeoutBreaker();
  private config: RetryEngineConfig;

  constructor(
    authProfiles: AuthProfileManager,
    config: Partial<RetryEngineConfig> & { providerId: string },
  ) {
    this.failover = new FailoverPolicy(authProfiles);
    this.config = {
      maxRetries: config.maxRetries ?? 3,
      baseBackoffMs: config.baseBackoffMs ?? 1000,
      maxBackoffMs: config.maxBackoffMs ?? 30000,
      providerId: config.providerId,
    };
  }

  async execute<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    turnId: string,
    onCompaction?: () => Promise<void>,
    onProfileRotation?: () => Promise<void>,
    onFallback?: () => Promise<void>,
    onRetryInstruction?: (instruction: string) => Promise<void>,
  ): Promise<T> {
    this.statusBuffer.reset();
    this.idleBreaker.reset();

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      if (this.idleBreaker.shouldBreak()) {
        throw new Error(
          `Idle timeout breaker tripped after ${attempt} attempts`,
        );
      }

      const watchdog = new StaleWatchdog(90000, 60000);
      const signal = watchdog.signal;

      try {
        const result = await operation(signal);
        watchdog.clear();
        this.statusBuffer.clear();
        return result;
      } catch (err) {
        watchdog.clear();

        const classified = this.classifier.classify(err);

        this.statusBuffer.add(
          turnId,
          `Attempt ${attempt}/${this.config.maxRetries}: ${classified.reason} - ${classified.providerMessage ?? 'unknown error'}`,
        );

        if (!classified.retryable || attempt >= this.config.maxRetries) {
          throw new Error(this.statusBuffer.flush(turnId));
        }

        const action = this.failover.decide(
          classified,
          attempt,
          this.config.providerId,
        );

        await this.executeAction(
          action,
          onCompaction,
          onProfileRotation,
          onFallback,
          onRetryInstruction,
        );

        if (action.type === 'surface_error') {
          throw new Error(action.message);
        }

        await this.backoff(attempt);

        if (classified.reason === 'timeout') {
          this.idleBreaker.step();
        }
      }
    }

    throw new Error(
      `Max retries (${this.config.maxRetries}) exceeded. ${this.statusBuffer.flush(turnId)}`,
    );
  }

  private async executeAction(
    action: RetryAction,
    onCompaction?: () => Promise<void>,
    onProfileRotation?: () => Promise<void>,
    onFallback?: () => Promise<void>,
    onRetryInstruction?: (instruction: string) => Promise<void>,
  ): Promise<void> {
    switch (action.type) {
      case 'compact_and_retry':
        if (onCompaction) await onCompaction();
        break;

      case 'rotate_profile_and_retry':
        if (onProfileRotation) await onProfileRotation();
        break;

      case 'fallback_model_and_retry':
        if (onFallback) await onFallback();
        break;

      case 'inject_retry_instruction':
        if (onRetryInstruction) await onRetryInstruction(action.instruction);
        break;

      case 'surface_error':
        break;
    }
  }

  private async backoff(attempt: number): Promise<void> {
    const base = Math.min(
      this.config.baseBackoffMs * 2 ** (attempt - 1),
      this.config.maxBackoffMs,
    );
    const jitter = Math.random() * (base * 0.5);
    const delay = base + jitter;

    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  getStatusBuffer(): RetryStatusBuffer {
    return this.statusBuffer;
  }

  getIdleBreaker(): IdleTimeoutBreaker {
    return this.idleBreaker;
  }
}
