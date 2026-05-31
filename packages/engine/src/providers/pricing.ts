import type { ModelPricing } from '@agentx/shared';

/**
 * Pricing per million tokens for common models.
 * Based on published API pricing as of March 2026.
 */
const PRICING: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-4o': { inputPerMillion: 2.50, outputPerMillion: 10.00 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.60 },
  'gpt-4o-audio': { inputPerMillion: 2.50, outputPerMillion: 10.00 },
  'gpt-4.1': { inputPerMillion: 2.00, outputPerMillion: 8.00 },
  'gpt-4.1-mini': { inputPerMillion: 0.40, outputPerMillion: 1.60 },
  'gpt-4.1-nano': { inputPerMillion: 0.10, outputPerMillion: 0.40 },
  'gpt-4.5': { inputPerMillion: 75.00, outputPerMillion: 150.00 },
  'o1': { inputPerMillion: 15.00, outputPerMillion: 60.00 },
  'o3-mini': { inputPerMillion: 1.10, outputPerMillion: 4.40 },
  'o4-mini': { inputPerMillion: 1.10, outputPerMillion: 4.40 },

  // Anthropic
  'claude-sonnet-4': { inputPerMillion: 3.00, outputPerMillion: 15.00 },
  'claude-haiku-3.5': { inputPerMillion: 0.80, outputPerMillion: 4.00 },
  'claude-opus-4': { inputPerMillion: 15.00, outputPerMillion: 75.00 },

  // Google
  'gemini-2.0-flash': { inputPerMillion: 0.10, outputPerMillion: 0.40 },
  'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 10.00 },
  'gemini-2.5-flash': { inputPerMillion: 0.15, outputPerMillion: 0.60 },

  // Meta (via Together/OpenRouter)
  'llama-4-scout': { inputPerMillion: 0.30, outputPerMillion: 0.30 },
  'llama-4-maverick': { inputPerMillion: 0.60, outputPerMillion: 0.60 },
  'llama-3.3-70b': { inputPerMillion: 0.59, outputPerMillion: 0.79 },

  // DeepSeek
  'deepseek-v3': { inputPerMillion: 0.27, outputPerMillion: 1.10 },
  'deepseek-r1': { inputPerMillion: 0.55, outputPerMillion: 2.19 },

  // Mistral
  'mistral-large': { inputPerMillion: 2.00, outputPerMillion: 6.00 },
  'mistral-small': { inputPerMillion: 0.20, outputPerMillion: 0.60 },

  // Cohere
  'command-r7b': { inputPerMillion: 0.15, outputPerMillion: 0.60 },

  // OpenRouter (dynamic — default estimate)
  'openrouter': { inputPerMillion: 2.00, outputPerMillion: 8.00 },

  // Ollama (local — free)
  'ollama': { inputPerMillion: 0, outputPerMillion: 0 },
};

export function getModelPricing(modelId: string): ModelPricing {
  // Direct match
  if (PRICING[modelId]) return { ...PRICING[modelId] };

  // Partial match
  const lower = modelId.toLowerCase();
  for (const [key, pricing] of Object.entries(PRICING)) {
    if (lower.includes(key)) return { ...pricing };
  }

  // Default fallback
  return { inputPerMillion: 1.00, outputPerMillion: 4.00 };
}
