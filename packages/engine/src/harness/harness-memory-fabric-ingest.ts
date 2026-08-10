import type { HarnessEntry } from '@agentx/shared';
import { getLogger, isHarnessMemoryFabricIngestEnabled } from '@agentx/shared';
import { getMemoryFabricInstance } from '../neural/MemoryFabric.js';
import { getBackgroundTaskPool } from '../runtime/BackgroundTaskPool.js';

export const HARNESS_MEMORY_FABRIC_TAG = 'harness_memory';

/** Opt-in: copy harness `memory` entries into MemoryFabric after refine (X-INT-08). */
export async function ingestHarnessMemoryEntriesToFabric(
  entries: HarnessEntry[],
  sessionId?: string,
): Promise<number> {
  if (!isHarnessMemoryFabricIngestEnabled()) return 0;
  const fabric = getMemoryFabricInstance();
  if (!fabric) return 0;

  const memoryEntries = entries.filter((e) => e.kind === 'memory' && (e.content?.trim() || e.title?.trim()));
  if (memoryEntries.length === 0) return 0;

  return getBackgroundTaskPool().run(async () => {
    let stored = 0;
    for (const entry of memoryEntries) {
      try {
        const label = (entry.title?.trim() || entry.id).slice(0, 80);
        const content = entry.content?.trim() || entry.title?.trim() || '';
        if (!content) continue;
        if (sessionId && await fabric.hasTaggedMemory(sessionId, HARNESS_MEMORY_FABRIC_TAG, label)) {
          continue;
        }
        await fabric.createNode({
          id: `harness:${entry.id}`,
          label,
          category: 'semantic',
          content,
          sessionId: sessionId ?? undefined,
          tag: HARNESS_MEMORY_FABRIC_TAG,
          confidence: 0.85,
          provenance: {
            harnessEntryId: entry.id,
            harnessKind: entry.kind,
            source: 'harness_refine',
            ingestedAt: new Date().toISOString(),
          },
        });
        stored += 1;
      } catch (e) {
        getLogger().warn(
          'HARNESS_FABRIC',
          `Failed to ingest harness memory "${entry.title}": ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    if (stored > 0) {
      getLogger().info('HARNESS_FABRIC', `Ingested ${stored} harness memory node(s) into MemoryFabric`);
    }
    return stored;
  });
}
