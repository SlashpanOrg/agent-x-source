// @ts-nocheck — TODO: fix type drift
import { getLogger } from '@agentx/shared';

export type ErrorCategory = 'internal' | 'input' | 'tool' | 'provider' | 'permission' | 'timeout' | 'unknown';

export interface ShieldedError {
  category: ErrorCategory;
  message: string;
  code?: string;
  context?: Record<string, unknown>;
  original?: unknown;
  timestamp: number;
}

export class ErrorShield {
  wrap<T>(operation: () => T, fallback: T): T {
    try {
      return operation();
    } catch (error) {
      this.logError(error);
      return fallback;
    }
  }

  async wrapAsync<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.logError(error);
      return fallback;
    }
  }

  shield(error: unknown, context?: Record<string, unknown>): ShieldedError {
    const timestamp = Date.now();
    const category = this.categorize(error);
    const message = this.sanitizeMessage(error);
    const code = this.extractCode(error);

    const shielded: ShieldedError = { category, message, timestamp, context, original: error };
    if (code) shielded.code = code;

    this.emitSafeError(shielded);
    return shielded;
  }

  async shieldAsync<T>(operation: () => Promise<T>, context?: Record<string, unknown>): Promise<{ result: T | null; error?: ShieldedError }> {
    try {
      const result = await operation();
      return { result };
    } catch (error) {
      const shielded = this.shield(error, context);
      return { result: null, error: shielded };
    }
  }

  private categorize(error: unknown): ErrorCategory {
    if (!error) return 'unknown';
    const msg = String(error);
    if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('TIMEOUT')) return 'timeout';
    if (msg.includes('permission') || msg.includes('PERMISSION') || msg.includes('denied') || msg.includes('EACCES')) return 'permission';
    if (msg.includes('not found') || msg.includes('NOT_FOUND') || msg.includes('ENOENT')) return 'internal';
    if (msg.includes('validation') || msg.includes('VALIDATION') || msg.includes('schema')) return 'input';
    if (msg.includes('tool') || msg.includes('TOOL') || msg.includes('handler')) return 'tool';
    if (msg.includes('provider') || msg.includes('PROVIDER') || msg.includes('API') || msg.includes('api')) return 'provider';
    if (msg.includes('undefined') || msg.includes('null') || msg.includes('TypeError') || msg.includes('ReferenceError')) return 'internal';
    return 'unknown';
  }

  private sanitizeMessage(error: unknown): string {
    const msg = error instanceof Error ? error.message : String(error);
    return msg
      .replace(/(api[_-]?key|secret|token|password|credential)[=:]\s*\S+/gi, '$1=***')
      .replace(/\/home\/[^/\s]+/g, '/home/**')
      .replace(/\/Users\/[^/\s]+/g, '/Users/**')
      .slice(0, 500);
  }

  private extractCode(error: unknown): string | undefined {
    if (error && typeof error === 'object') {
      const e = error as Record<string, unknown>;
      if (typeof e['code'] === 'string') return e['code'] as string;
    }
    return undefined;
  }

  private emitSafeError(shielded: ShieldedError): void {
    getLogger().warn('ERROR_SHIELD', {
      category: shielded.category,
      code: shielded.code,
      message: shielded.message,
      timestamp: shielded.timestamp,
    });
  }

  logError(error: unknown): void {
    getLogger().error('ERROR_SHIELD', error);
  }

  userFacingMessage(error: ShieldedError): string {
    switch (error.category) {
      case 'timeout':
        return 'That operation took too long. Please try a simpler request or try again.';
      case 'permission':
        return "I don't have permission to do that. Please adjust permissions in settings.";
      case 'input':
        return 'I received invalid input for that operation. Please check your request.';
      case 'tool':
        return 'Something went wrong with a tool. Let me try a different approach.';
      case 'provider':
        return 'The AI provider encountered an issue. Please try again.';
      case 'internal':
      case 'unknown':
      default:
        return 'Something unexpected happened. Session has been saved and you can continue.';
    }
  }
}
