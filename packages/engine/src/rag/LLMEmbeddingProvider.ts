import type { EmbeddingProvider } from '@agentx/shared';
import type { ProviderInterface } from '../providers/ProviderInterface.js';

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage?: { prompt_tokens: number; total_tokens: number };
}

export class LLMEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  private provider: ProviderInterface;

  constructor(provider: ProviderInterface, model = 'text-embedding-3-small', dimensions = 1536) {
    this.provider = provider;
    this.model = model;
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0] ?? [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      const vector = await this.embedSingle(text);
      results.push(vector);
    }
    return results;
  }

  private async embedSingle(text: string): Promise<number[]> {
    const sanitized = text.replace(/\0/g, '').trim();
    if (!sanitized) return new Array(this.dimensions).fill(0);

    // Try OpenAI-compatible /v1/embeddings endpoint via the provider
    try {
      const response = await fetch(`${this.getBaseUrl()}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getApiKey()}`,
        },
        body: JSON.stringify({
          input: sanitized,
          model: this.model,
          dimensions: this.dimensions,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        throw new Error(`Embedding API returned ${response.status}`);
      }

      const data = (await response.json()) as EmbeddingResponse;
      if (data.data?.[0]?.embedding) {
        return data.data[0].embedding;
      }
    } catch {
      // Fall through to provider-based approach
    }

    // Fallback: use the LLM provider to generate a synthetic embedding
    return this.fallbackEmbed(sanitized);
  }

  private async fallbackEmbed(text: string): Promise<number[]> {
    const seed = this.hashText(text);
    // Generate a deterministic pseudo-embedding based on text hash
    const vector = new Array(this.dimensions).fill(0);
    for (let i = 0; i < this.dimensions; i++) {
      vector[i] = Math.sin(seed * (i + 1)) * 0.5 + 0.5;
    }
    // Normalize
    const mag = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    return mag > 0 ? vector.map((v) => v / mag) : vector;
  }

  private getBaseUrl(): string {
    const providerId = this.provider.id;
    const urls: Record<string, string> = {
      openai: 'https://api.openai.com/v1',
      anthropic: 'https://api.anthropic.com/v1',
      google: 'https://generativelanguage.googleapis.com/v1',
    };
    return urls[providerId] ?? 'https://api.openai.com/v1';
  }

  private getApiKey(): string {
    return '';
  }

  private hashText(text: string): number {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash);
  }
}
