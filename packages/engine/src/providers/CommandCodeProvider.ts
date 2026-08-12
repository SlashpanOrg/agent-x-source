import type { CompletionRequest, ModelInfo } from '@agentx/shared';
import {
  apiRecordToModelInfo,
  parseCommandCodeModelProtocol,
  resolveCommandCodeOpenAiBaseUrl,
} from '@agentx/shared';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js';
import {
  resolveCommandCodeReasoningInfo,
  sanitizeCommandCodeReasoningEffort,
} from './commandcode/commandcode-metadata.js';

/**
 * Multi-protocol aggregator provider: one API key, dual native transports
 * (chat-completions and messages). Model listing uses the chat-completions
 * /models path; per-model protocol comes from API metadata when present,
 * otherwise from catalog heuristics.
 *
 * CommandCode validates `reasoning_effort` as low|medium|high|xhigh|max —
 * never `none`/`minimal`. See commandcode-metadata.ts.
 */
export class CommandCodeProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string, baseUrl?: string) {
    super(
      'commandcode',
      'CommandCode',
      apiKey,
      resolveCommandCodeOpenAiBaseUrl(baseUrl),
    );
  }

  protected override parseModels(items: Array<Record<string, unknown>>): ModelInfo[] {
    const models: ModelInfo[] = [];
    for (const record of items) {
      const id = String(record['id'] ?? record['name'] ?? '').trim();
      const info = apiRecordToModelInfo(record, this.id, this.getCapabilities(id));
      if (!info) continue;
      const reasoning = resolveCommandCodeReasoningInfo(id);
      const capabilities = info.capabilities.includes('reasoning')
        ? info.capabilities
        : [...info.capabilities, 'reasoning' as const];
      models.push({
        ...info,
        capabilities,
        reasoning,
        apiProtocol: parseCommandCodeModelProtocol(id, record),
      });
    }
    return models.sort((a, b) => a.name.localeCompare(b.name));
  }

  protected override mapReasoningEffort(
    effort: CompletionRequest['reasoningEffort'],
    _modelId: string,
  ): string | undefined {
    return sanitizeCommandCodeReasoningEffort(effort);
  }
}
