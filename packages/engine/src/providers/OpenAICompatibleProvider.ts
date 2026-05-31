import type {
  ModelInfo,
  ProviderId,
} from '@agentx/shared';
import { OpenAIProvider } from './OpenAIProvider.js';

/**
 * Generic OpenAI-compatible provider.
 * Covers any provider that uses the standard OpenAI API format
 * (/models, /chat/completions, streaming SSE).
 */
export class OpenAICompatibleProvider extends OpenAIProvider {
  readonly id: ProviderId;
  readonly name: string;

  constructor(id: ProviderId, name: string, apiKey: string, baseUrl: string) {
    super(apiKey, baseUrl);
    this.id = id;
    this.name = name;
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { data: Array<{ id: string }> };
    return data.data
      .map((m): ModelInfo => ({
        id: m.id,
        name: m.id,
        providerId: this.id,
        contextWindow: this.getContextWindow(m.id),
        capabilities: this.getCapabilities(m.id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

}
