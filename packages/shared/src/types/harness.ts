/** Continual Harness — supplemental prompt state (Prime Agent adoption). */

export type HarnessKind = 'prompt' | 'memory' | 'skill' | 'subagent';
export type HarnessScope = 'local' | 'global';
export type RefinementAction = 'create' | 'update' | 'delete';

export interface HarnessEntry {
  id: string;
  kind: HarnessKind;
  title: string;
  content: string;
  path: string;
  scope?: HarnessScope;
  reference: Record<string, unknown>;
  arguments: Record<string, unknown>;
  metadata: Record<string, unknown>;
  source: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface HarnessRefinementEvent {
  id: string;
  trigger: string;
  changes: string[];
  evidence: string;
  outcome: string;
  created_at: string;
  rollback_id?: string;
  before_snapshot?: HarnessState;
  after_snapshot?: HarnessState;
}

export interface HarnessState {
  schema: number;
  entries: Record<HarnessKind, Record<string, HarnessEntry>>;
  refinements: HarnessRefinementEvent[];
}

export interface RefinementEdit {
  action: RefinementAction;
  kind: HarnessKind;
  id?: string;
  title?: string;
  content?: string;
  path?: string;
  reference?: Record<string, unknown>;
  arguments?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  reason?: string;
}

export interface RefinementProposal {
  summary: string;
  rationale: string;
  edits: RefinementEdit[];
}

export const HARNESS_STATE_SCHEMA_VERSION = 1;

export function createEmptyHarnessState(): HarnessState {
  return {
    schema: HARNESS_STATE_SCHEMA_VERSION,
    entries: {
      prompt: {},
      memory: {},
      skill: {},
      subagent: {},
    },
    refinements: [],
  };
}
