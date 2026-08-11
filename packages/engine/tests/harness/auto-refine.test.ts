import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configureAdoptionFromConfig } from '@agentx/shared';
import { reviewAutoRefine } from '../../src/harness/auto-refine.js';
import { getHarnessService } from '../../src/harness/HarnessService.js';

describe('auto-refine', () => {
  beforeEach(() => {
    configureAdoptionFromConfig({
      provider: { activeProvider: 'openai', activeModel: 'gpt-4' },
      ui: {},
      organization: null,
      telemetry: false,
      adoption: {
        harness: { enabled: true, autoRefineOnCompaction: true },
      },
    });
  });

  it('schedules harness refine after compaction when enabled', async () => {
    const refineSpy = vi.spyOn(getHarnessService(), 'refine').mockResolvedValue({ ok: true, applied: 1 });
    const agent = {
      sessionId: 'sess-auto-refine',
      isCompactionInFlight: () => false,
      refineHarness: async () => ({ ok: true }),
    } as never;

    reviewAutoRefine(agent, 'compaction');
    await new Promise((r) => setTimeout(r, 700));

    expect(refineSpy).not.toHaveBeenCalled();

    const agentWithRefine = {
      sessionId: 'sess-auto-refine-2',
      isCompactionInFlight: () => false,
      refineHarness: vi.fn().mockResolvedValue({ ok: true }),
    } as never;

    reviewAutoRefine(agentWithRefine, 'compaction');
    await new Promise((r) => setTimeout(r, 700));
    expect(agentWithRefine.refineHarness).toHaveBeenCalled();
  });
});
