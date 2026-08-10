import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { configureAdoptionFromConfig } from '@agentx/shared';
import { setAdoptionDbPool } from '../../src/adoption/adoption-db.js';
import { getDurableTurnStore } from '../../src/durable-turn/DurableTurnStore.js';
import { AdoptionFakePgPool } from './adoption-fake-pg.js';

describe('Phase 2 durable turn restart integration', () => {
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
  });

  it('marks stale running turns on restart and turn remains queryable', async () => {
    const store = getDurableTurnStore();
    const turn = await store.create('sess-crash', 1, 'turn-crash-1');
    await store.updateStatus(turn.turnId, 'running', 'partial output');

    const swept = await store.sweepStaleOnStartup('fail_on_stale');
    expect(swept).toBe(1);

    const record = await store.getTurn('turn-crash-1');
    expect(record?.status).toBe('error');
    expect(record?.error).toBe('stale_after_restart');
    expect(record?.partialContent).toBe('partial output');
  });
});
