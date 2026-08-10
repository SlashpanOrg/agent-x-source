import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HarnessStore } from '../../src/harness/HarnessStore.js';
import { applyRefinementProposal, rollbackRefinement } from '../../src/harness/applyRefinement.js';

describe('rollbackRefinement', () => {
  const dir = join(tmpdir(), `agentx-harness-rollback-${Date.now()}`);
  const prev = process.env['AGENTX_DATA_DIR'];
  const sessionId = 'sess-rb';

  beforeEach(() => {
    process.env['AGENTX_DATA_DIR'] = dir;
    mkdirSync(join(dir, 'sessions', sessionId, 'harness'), { recursive: true });
  });

  afterEach(() => {
    if (prev) process.env['AGENTX_DATA_DIR'] = prev;
    else delete process.env['AGENTX_DATA_DIR'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('restores harness state from refinement before_snapshot', async () => {
    const store = new HarnessStore();
    const result = await applyRefinementProposal(store, 'local', sessionId, {
      summary: 'add',
      rationale: 't',
      edits: [{ action: 'create', kind: 'memory', title: 'A', content: 'one', reason: 't' }],
    }, 'test');

    const ok = await rollbackRefinement(store, 'local', sessionId, result.refinementId);
    expect(ok).toBe(true);
    const entries = store.listEntries('local', sessionId);
    expect(entries.length).toBe(0);
  });
});
