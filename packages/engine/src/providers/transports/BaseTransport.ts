import type {
  ProviderPlan,
  ProviderRoute,
  ProviderTransport,
  AgentXStreamEvent,
} from '@agentx/shared';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export abstract class BaseTransport implements ProviderTransport {
  abstract id: string;
  abstract route: ProviderRoute;

  canHandle(plan: ProviderPlan): boolean {
    return plan.route === this.route.id;
  }

  preflight(plan: ProviderPlan): ProviderPlan {
    this.validatePlan(plan);
    return plan;
  }

  abstract stream(
    plan: ProviderPlan,
    signal: AbortSignal,
  ): AsyncIterable<AgentXStreamEvent>;

  protected buildUrl(_plan: ProviderPlan): URL {
    const base = this.route.endpoint.baseUrl.replace(/\/$/, '');
    return new URL(`${base}${this.route.endpoint.path}`);
  }

  protected async getHeaders(_plan: ProviderPlan): Promise<Record<string, string>> {
    const authHeaders = await this.route.auth.getHeaders();
    return {
      'Content-Type': 'application/json',
      ...authHeaders,
      ..._plan.http.headers,
    };
  }

  protected buildRequestBody(plan: ProviderPlan): unknown {
    return {
      model: plan.modelId,
      messages: this.route.protocol.convertMessages(plan.messages),
      tools: plan.tools.length > 0 ? this.route.protocol.convertTools(plan.tools) : undefined,
      tool_choice: plan.tools.length > 0 ? plan.toolChoice : undefined,
      temperature: plan.generation.temperature,
      top_p: plan.generation.topP,
      max_tokens: plan.generation.maxOutputTokens,
      stream: true,
    };
  }

  /**
   * Fetch with retry for transient HTTP errors (429, 500, 502, 503, 504).
   * Streaming requests can't be retried mid-stream, but we CAN retry the
   * initial connection if the provider's queue is full before streaming starts.
   * Returns the Response on success, throws on non-retryable errors.
   */
  protected async fetchStreamWithRetry(
    url: string,
    init: RequestInit,
    maxRetries = 2,
    baseDelayMs = 1_000,
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, init);

        if (response.ok) return response;

        if (RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
          const errorText = await response.text().catch(() => '');
          lastError = new Error(`HTTP ${response.status}: ${errorText.slice(0, 200)}`);
          const delay = baseDelayMs * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // Non-retryable or exhausted — return the response so the caller can
        // yield a proper provider.error event with the status code.
        return response;
      } catch (err) {
        if (err instanceof Error) {
          const isAbort = err.name === 'AbortError' || (init.signal as AbortSignal | undefined)?.aborted;
          if (isAbort) throw err;

          if (attempt < maxRetries) {
            lastError = err;
            const delay = baseDelayMs * Math.pow(2, attempt);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
        }
        throw err;
      }
    }

    throw lastError ?? new Error('fetchStreamWithRetry: exhausted retries');
  }

  private validatePlan(plan: ProviderPlan): void {
    if (!plan.messages || plan.messages.length === 0) {
      throw new Error('ProviderPlan must contain at least one message');
    }

    if (!plan.modelId) {
      throw new Error('ProviderPlan must contain a modelId');
    }

    const lastUserIdx = this.findLastIndex(
      plan.messages,
      (m) => m.role === 'user',
    );

    if (lastUserIdx === -1) {
      throw new Error('ProviderPlan must contain at least one user message');
    }
  }

  private findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (predicate(arr[i]!)) return i;
    }
    return -1;
  }
}
