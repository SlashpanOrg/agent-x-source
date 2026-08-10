import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configureAdoptionFromConfig } from '@agentx/shared';
import { HarnessStore } from '../../src/harness/HarnessStore.js';
import { applyRefinementProposal } from '../../src/harness/applyRefinement.js';

describe('applyRefinement', () => {
  const dir = join(tmpdir(), `agentx-apply-refine-${Date.now()}`);
  const prev = process.env['AGENTX_DATA_DIR'];
  const sessionId = 'sess-apply';

  beforeEach(() => {
    configureAdoptionFromConfig({
      provider: { activeProvider: 'openai', activeModel: 'gpt-4' },
      ui: {},
      organization: null,
      telemetry: false,
      adoption: { harness: { enabled: true } },
    });
    process.env['AGENTX_DATA_DIR'] = dir;
    mkdirSync(join(dir, 'sessions', sessionId, 'harness'), { recursive: true });
  });

  afterEach(() => {
    if (prev) process.env['AGENTX_DATA_DIR'] = prev;
    else delete process.env['AGENTX_DATA_DIR'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('applies multiple edits and records refinement event', async () => {
    const store = new HarnessStore();
    const result = await applyRefinementProposal(store, 'local', sessionId, {
      summary: 'batch',
      rationale: 't',
      edits: [
        { action: 'create', kind: 'memory', title: 'A', content: 'one', reason: 't' },
        { action: 'create', kind: 'memory', title: 'B', content: 'two', reason: 't' },
      ],
    }, 'test');
    expect(result.applied).toBe(2);
    expect(store.listEntries('local', sessionId).length).toBe(2);
    const events = store.listRefinements('local', sessionId);
    expect(events.some((e) => e.id === result.refinementId)).toBe(true);
  });
});
