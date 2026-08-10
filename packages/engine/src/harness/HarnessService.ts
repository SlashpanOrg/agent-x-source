import type { HarnessScope } from '@agentx/shared';
import { isHarnessEnabled } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { incrementAdoptionMetric } from '../adoption/adoption-metrics.js';
import { withSpan } from '../observability/tracer.js';
import { HarnessStore } from './HarnessStore.js';
import { formatHarnessForPrompt } from './formatHarnessForPrompt.js';
import { applyRefinementProposal, rollbackRefinement } from './applyRefinement.js';
import { planRefinement } from './planRefinement.js';
import { ingestHarnessMemoryEntriesToFabric } from './harness-memory-fabric-ingest.js';

let harnessServiceInstance: HarnessService | null = null;

export function getHarnessService(): HarnessService {
  if (!harnessServiceInstance) {
    harnessServiceInstance = new HarnessService();
  }
  return harnessServiceInstance;
}

export function setHarnessServiceInstance(service: HarnessService): void {
  harnessServiceInstance = service;
}

export class HarnessService {
  private readonly store = new HarnessStore();
  private readonly refineLocks = new Set<string>();
  private readonly eventSink: Array<(event: Record<string, unknown>) => void> = [];

  onEvent(handler: (event: Record<string, unknown>) => void): void {
    this.eventSink.push(handler);
  }

  private emitEvent(event: Record<string, unknown>): void {
    for (const h of this.eventSink) {
      try { h(event); } catch { /* ignore */ }
    }
  }

  isEnabled(): boolean {
    return isHarnessEnabled();
  }

  getPromptBlock(sessionId: string): string {
    if (!this.isEnabled()) return '';
    const local = this.store.getFileStore().listEntries('local', sessionId);
    const global = this.store.getFileStore().listEntries('global');
    return formatHarnessForPrompt(local, global);
  }

  listEntries(sessionId: string, scope: HarnessScope = 'local') {
    return this.store.listEntries(scope, scope === 'local' ? sessionId : undefined);
  }

  listRefinements(sessionId: string, scope: HarnessScope = 'local') {
    return this.store.listRefinements(scope, scope === 'local' ? sessionId : undefined);
  }

  isRefineInFlight(sessionId: string): boolean {
    return this.refineLocks.has(sessionId);
  }

  async refine(
    sessionId: string,
    options: {
      scope?: HarnessScope;
      instructions?: string;
      trajectorySummary: string;
      complete: (prompt: string) => Promise<string>;
      isCompactionInFlight?: () => boolean;
    },
  ): Promise<{ ok: boolean; summary?: string; applied?: number; error?: string; refinementId?: string }> {
    if (!this.isEnabled()) {
      return { ok: false, error: 'Harness is disabled in app settings (adoption.harness)' };
    }
    if (this.refineLocks.has(sessionId)) {
      return { ok: false, error: 'Refinement already in flight for this session' };
    }

    const scope = options.scope ?? 'local';
    let compactionWaits = 0;
    while (options.isCompactionInFlight?.() && compactionWaits < 24) {
      await new Promise((r) => setTimeout(r, 250));
      compactionWaits += 1;
    }
    this.refineLocks.add(sessionId);
    this.emitEvent({ type: 'harness_refinement_start', sessionId, scope });
    try {
      return await withSpan('harness.refine', 'harness', async (span) => {
        span.setAttribute('harness.scope', scope);
        span.setAttribute('session.id', sessionId);
        const { proposal, raw } = await planRefinement({
        scope,
        sessionId: scope === 'local' ? sessionId : undefined,
        instructions: options.instructions,
        trajectorySummary: options.trajectorySummary,
        complete: options.complete,
      });

      if (!proposal || proposal.edits.length === 0) {
        getLogger().warn('HARNESS', `Refine produced no valid proposal: ${raw.slice(0, 200)}`);
        this.emitEvent({ type: 'harness_refinement_failed', sessionId, error: 'invalid proposal' });
        return { ok: false, error: 'Planner did not return a valid refinement proposal' };
      }

      const result = await applyRefinementProposal(
        this.store,
        scope,
        scope === 'local' ? sessionId : undefined,
        proposal,
        options.instructions ?? 'refine',
      );

      this.emitEvent({
        type: 'harness_refinement_complete',
        sessionId,
        scope,
        summary: proposal.summary,
        editCount: result.applied,
      });
      incrementAdoptionMetric('harness_refinements_total');

      const listed = await this.store.listEntries(scope, scope === 'local' ? sessionId : undefined);
      const memoryEntries = listed.filter((e) => e.kind === 'memory');
      void ingestHarnessMemoryEntriesToFabric(memoryEntries, scope === 'local' ? sessionId : undefined).catch(() => {});

      return {
        ok: true,
        summary: proposal.summary,
        applied: result.applied,
        refinementId: result.refinementId,
      };
      }, { 'harness.scope': scope, 'session.id': sessionId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      getLogger().error('HARNESS', `Refine failed: ${message}`);
      this.emitEvent({ type: 'harness_refinement_failed', sessionId, error: message });
      return { ok: false, error: message };
    } finally {
      this.refineLocks.delete(sessionId);
    }
  }

  async rollback(sessionId: string, rollbackId: string, scope: HarnessScope = 'local'): Promise<boolean> {
    const ok = await rollbackRefinement(
      this.store,
      scope,
      scope === 'local' ? sessionId : undefined,
      rollbackId,
    );
    if (ok) incrementAdoptionMetric('harness_rollbacks_total');
    return ok;
  }
}
