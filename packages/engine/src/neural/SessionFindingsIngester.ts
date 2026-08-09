/**
 * Persists research tool outputs into session-scoped memory for cross-turn reuse.
 * Tag: session_findings — retrieved on every turn so the agent does not re-search the web.
 */
import type { EmbeddingProvider } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import type { MemoryFabric } from './MemoryFabric.js';
import { getBackgroundTaskPool } from '../runtime/BackgroundTaskPool.js';

export const SESSION_FINDINGS_TAG = 'session_findings';

const RESEARCH_TOOLS = new Set([
  'web_search',
  'deep_web_search',
  'web_fetch',
  'web_scrape',
  'knowledge_base_search',
  'cortex_memory_search',
]);

const MAX_OUTPUT_CHARS = 2_400;
const MIN_OUTPUT_CHARS = 80;

export interface ToolFindingRecord {
  name: string;
  success: boolean;
  output: string;
}

function summarizeOutput(toolName: string, output: string): string {
  const trimmed = output.trim();
  if (!trimmed) return '';
  const slice = trimmed.length > MAX_OUTPUT_CHARS
    ? `${trimmed.slice(0, MAX_OUTPUT_CHARS)}\n… [truncated for memory index]`
    : trimmed;
  return `Tool: ${toolName}\n${slice}`;
}

export class SessionFindingsIngester {
  constructor(
    private fabric: MemoryFabric,
    private embedder: EmbeddingProvider,
  ) {}

  async ingestToolFindings(
    records: ToolFindingRecord[],
    sourceSessionId: string,
    storageSessionId?: string,
    userQueryHint?: string,
  ): Promise<number> {
    const eligible = records.filter(
      (r) => r.success && RESEARCH_TOOLS.has(r.name) && r.output.trim().length >= MIN_OUTPUT_CHARS,
    );
    if (eligible.length === 0) return 0;

    return getBackgroundTaskPool().run(async () => {
      let stored = 0;
      for (const record of eligible) {
        const content = summarizeOutput(record.name, record.output);
        const label = `${record.name}: ${(userQueryHint ?? content).slice(0, 72)}`;
        try {
          if (await this.fabric.hasTaggedMemory(sourceSessionId, SESSION_FINDINGS_TAG, label)) {
            continue;
          }
          const embedding = await this.embedder.embed(content);
          await this.fabric.createNode({
            label,
            category: 'semantic',
            content,
            embedding,
            tag: SESSION_FINDINGS_TAG,
            sessionId: storageSessionId,
            confidence: 0.92,
            provenance: {
              type: 'tool_finding',
              sourceSessionId,
              tool: record.name,
              ingestedAt: new Date().toISOString(),
            },
          });
          stored += 1;
        } catch (e) {
          getLogger().warn(
            'SESSION_FINDINGS',
            `Failed to store ${record.name} finding: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      if (stored > 0) {
        getLogger().info('SESSION_FINDINGS', `Stored ${stored} tool finding(s) for session ${sourceSessionId.slice(0, 8)}`);
      }
      return stored;
    });
  }
}
