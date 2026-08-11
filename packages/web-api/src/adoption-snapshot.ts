import {
  getDurableTurnStore,
  getGoalService,
  getHarnessService,
  getSessionGenerationManager,
} from '@agentx/engine';
import { getEngine } from './engine.js';
import { turnRegistry } from './turn-registry.js';

export async function buildSessionSnapshot(sessionId: string): Promise<Record<string, unknown>> {
  const eng = getEngine();
  const store = eng.sessionManager.getStorageAdapter();
  const messages = store?.getMessages ? await store.getMessages(sessionId) : [];
  const generation = await getSessionGenerationManager().getGeneration(sessionId);
  const activeTurn = turnRegistry.getBySessionId(sessionId);
  const durableTurn = await getDurableTurnStore().getActive(sessionId);
  const goal = getGoalService().getStatus(sessionId);
  const harnessEntries = await Promise.resolve(getHarnessService().listEntries(sessionId, 'local'));

  return {
    sessionId,
    generation,
    messages,
    activeTurn: activeTurn
      ? {
          turnId: activeTurn.turnId,
          status: activeTurn.status,
          partialContent: activeTurn.partialContent,
        }
      : null,
    durableTurn,
    goal,
    harnessSummary: {
      entryCount: harnessEntries.length,
      kinds: harnessEntries.slice(0, 8).map((e) => ({ id: e.id, kind: e.kind, title: e.title })),
    },
    timestamp: new Date().toISOString(),
  };
}
