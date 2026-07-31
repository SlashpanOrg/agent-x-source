import type { ToolExecutor, ToolRegistry } from '@agentx/engine';
import { getLogger } from '@agentx/shared';
import { getEngine } from '../engine.js';

/** Point IntegrationHub back at the primary chat/local-voice toolkit. */
export function restorePrimaryToolkitBridge(): void {
  try {
    const eng = getEngine();
    eng.integrationHub.setToolkitBridge(eng.toolkit.registry, eng.toolkit.executor);
    eng.integrationHub.syncToToolkit(eng.toolkit.registry, eng.toolkit.executor);
  } catch (err) {
    getLogger().warn(
      'VOICE_INTEGRATION_BRIDGE_RESTORE',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Sync connected MCP + native integration tools into a toolkit registry/executor
 * (e.g. xAI realtime voice) without leaving IntegrationHub bridged away from the
 * primary agent toolkit used by chat / local voice.
 *
 * Connection sync is ENABLED (not skipped) so that MCP connections that aren't
 * already active get synced before tool registration. Without this, voice sessions
 * that start before any chat session would have zero MCP tools available because
 * `registerConnectionTools` only registers tools for connections that are already
 * in `this.sessions`. The `prepareForAgentTurn` has a 3-second budget for
 * connection sync, and the caller should allow at least 8 seconds total.
 */
export async function syncIntegrationToolsIntoToolkit(
  registry: ToolRegistry,
  executor: ToolExecutor,
  userText = '',
): Promise<{ registeredCount: number; connectedNames: string[] }> {
  const eng = getEngine();
  try {
    const { snapshot } = await eng.integrationHub.prepareForAgentTurn(
      registry,
      executor,
      userText,
      { skipConnectionSync: false },
    );
    return {
      registeredCount: snapshot.registeredCount,
      connectedNames: snapshot.connected.map((c) => c.name),
    };
  } catch (err) {
    getLogger().warn(
      'VOICE_INTEGRATION_SYNC',
      err instanceof Error ? err.message : String(err),
    );
    return { registeredCount: 0, connectedNames: [] };
  } finally {
    // Always restore the primary bridge so chat/local-agent turns keep syncing
    // into eng.toolkit — prepareForAgentTurn temporarily retargets it.
    restorePrimaryToolkitBridge();
  }
}
