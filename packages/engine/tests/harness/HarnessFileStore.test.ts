import { describe, it, expect, afterEach } from 'vitest';
import { HarnessStore } from '../../src/harness/HarnessStore.js';
import { formatHarnessForPrompt } from '../../src/harness/formatHarnessForPrompt.js';
import { applyRefinementProposal } from '../../src/harness/applyRefinement.js';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('HarnessFileStore', () => {
  it('applies create edit and formats for prompt', async () => {
    const prev = process.env['AGENTX_DATA_DIR'];
    const dir = join(tmpdir(), `agentx-harness-test-${Date.now()}`);
    process.env['AGENTX_DATA_DIR'] = dir;
    try {
      const store = new HarnessStore();
      const sessionId = 'sess-test-1';
      mkdirSync(join(dir, 'sessions', sessionId, 'harness'), { recursive: true });

      await applyRefinementProposal(store, 'local', sessionId, {
        summary: 'add note',
        rationale: 'test',
        edits: [{
          action: 'create',
          kind: 'memory',
          title: 'Test',
          content: 'Remember to run tests',
          reason: 'unit test',
        }],
      }, 'test');

      const entries = store.listEntries('local', sessionId);
      expect(entries.length).toBe(1);
      const block = formatHarnessForPrompt(entries, []);
      expect(block).toContain('Remember to run tests');
    } finally {
      if (prev) process.env['AGENTX_DATA_DIR'] = prev;
      else delete process.env['AGENTX_DATA_DIR'];
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
