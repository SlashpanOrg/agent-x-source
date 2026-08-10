import { randomUUID } from 'node:crypto';
import type {
  HarnessScope,
  RefinementEdit,
  RefinementProposal,
} from '@agentx/shared';

import { getAdoptionDbPool } from '../adoption/adoption-db.js';
import type { HarnessStore } from './HarnessStore.js';

export function parseRefinementProposal(raw: string): RefinementProposal | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as RefinementProposal;
    if (!parsed || !Array.isArray(parsed.edits)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface ApplyRefinementResult {
  applied: number;
  refinementId: string;
  beforeSnapshot: Awaited<ReturnType<HarnessStore['cloneState']>>;
  afterSnapshot: Awaited<ReturnType<HarnessStore['cloneState']>>;
}

export async function applyRefinementProposal(
  store: HarnessStore,
  scope: HarnessScope,
  sessionId: string | undefined,
  proposal: RefinementProposal,
  trigger: string,
): Promise<ApplyRefinementResult> {
  const beforeSnapshot = await store.cloneState(scope, sessionId);
  let applied = 0;

  for (const edit of proposal.edits) {
    await store.applyEdit(scope, sessionId, edit.action, edit.kind, {
      id: edit.id,
      title: edit.title,
      content: edit.content,
      path: edit.path,
      reference: edit.reference,
      arguments: edit.arguments,
      metadata: edit.metadata,
      source: 'refine',
    });
    applied += 1;
  }

  const afterSnapshot = await store.cloneState(scope, sessionId);
  const refinementId = randomUUID();
  await store.appendRefinement(scope, sessionId, {
    id: refinementId,
    trigger,
    changes: proposal.edits.map((e: RefinementEdit) => `${e.action}:${e.kind}:${e.title ?? e.id ?? ''}`),
    evidence: proposal.rationale,
    outcome: proposal.summary,
    created_at: new Date().toISOString(),
    before_snapshot: beforeSnapshot,
    after_snapshot: afterSnapshot,
  });

  return { applied, refinementId, beforeSnapshot, afterSnapshot };
}

export async function rollbackRefinement(
  store: HarnessStore,
  scope: HarnessScope,
  sessionId: string | undefined,
  rollbackId: string,
): Promise<boolean> {
  const refinements = await store.listRefinements(scope, sessionId);
  const event = refinements.find((r) => r.id === rollbackId);
  if (!event?.before_snapshot) return false;
  store.getFileStore().writeState(scope, sessionId, event.before_snapshot);
  if (getAdoptionDbPool()) {
    for (const kind of ['prompt', 'memory', 'skill', 'subagent'] as const) {
      for (const entry of Object.values(event.before_snapshot.entries[kind] ?? {})) {
        await store.upsertEntry(scope, sessionId, entry);
      }
    }
  }
  return true;
}
