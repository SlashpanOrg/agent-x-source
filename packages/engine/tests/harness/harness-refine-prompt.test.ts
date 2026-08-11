import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configureAdoptionFromConfig } from '@agentx/shared';
import { getHarnessService } from '../../src/harness/HarnessService.js';
import { formatHarnessForPrompt } from '../../src/harness/formatHarnessForPrompt.js';

describe('harness refine → prompt', () => {
  const dir = join(tmpdir(), `agentx-harness-int-${Date.now()}`);
  const prev = process.env['AGENTX_DATA_DIR'];
  const sessionId = 'sess-int';

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

  it('refine adds memory entry visible in prompt block', async () => {
    const harness = getHarnessService();
    const raw = JSON.stringify({
      summary: 'remember',
      rationale: 'test',
      edits: [{ action: 'create', kind: 'memory', title: 'Tip', content: 'Run graphify update', reason: 't' }],
    });
    const result = await harness.refine(sessionId, {
      trajectorySummary: 'discussed tooling',
      complete: async () => raw,
    });
    expect(result.ok).toBe(true);
    const block = harness.getPromptBlock(sessionId);
    expect(block).toContain('Run graphify update');
    const entries = harness.listEntries(sessionId);
    const block2 = formatHarnessForPrompt(entries, []);
    expect(block2).toContain('Run graphify update');
  });
});
