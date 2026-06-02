import type {
  ProviderPlan,
  ProviderRoute,
  ProviderTransport,
  AgentXStreamEvent,
} from '@agentx/shared';

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
