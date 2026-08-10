import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { configureAdoptionFromConfig } from '@agentx/shared';
import { setAdoptionDbPool } from '../../src/adoption/adoption-db.js';
import { getDurableTurnStore } from '../../src/durable-turn/DurableTurnStore.js';
import { markEngineShuttingDown, isEngineShuttingDown, resetEngineShutdownGateForTests } from '../../src/runtime/ShutdownGate.js';
import { AdoptionFakePgPool } from './adoption-fake-pg.js';

describe('Phase 2 shutdown checkpoint integration', () => {
  const pool = new AdoptionFakePgPool();

  beforeEach(() => {
    configureAdoptionFromConfig({
      provider: { activeProvider: 'openai', activeModel: 'gpt-4' },
      ui: {},
      organization: null,
      telemetry: false,
      adoption: { durableTurns: { enabled: true } },
    });
    setAdoptionDbPool(pool as never);
  });

  afterEach(() => {
    setAdoptionDbPool(null);
    resetEngineShutdownGateForTests();
  });

  it('preserves durable turn checkpoint when shutdown gate is raised mid-turn', async () => {
    const store = getDurableTurnStore();
    const turn = await store.create('sess-shut', 2, 'turn-shut-1');
    await store.updateStatus(turn.turnId, 'running', 'checkpoint body');
    await store.checkpoint(turn.turnId, 3, [{ type: 'text', content: 'chunk' }], 'checkpoint body');

    markEngineShuttingDown();
    expect(isEngineShuttingDown()).toBe(true);

    const record = await store.getTurn('turn-shut-1');
    expect(record?.status).toBe('running');
    expect(record?.partialContent).toBe('checkpoint body');
    expect(record?.sequence).toBe(3);
  });
});
