import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type {
  HarnessEntry,
  HarnessKind,
  HarnessRefinementEvent,
  HarnessScope,
  HarnessState,
  RefinementAction,
} from '@agentx/shared';
import { createEmptyHarnessState, HARNESS_STATE_SCHEMA_VERSION } from '@agentx/shared';
import {
  getGlobalHarnessDir,
  getSessionHarnessDir,
  HARNESS_STATE_FILE,
  REFINEMENTS_FILE,
} from './paths.js';

function harnessStatePath(dir: string): string {
  return join(dir, HARNESS_STATE_FILE);
}

function refinementsPath(dir: string): string {
  return join(dir, REFINEMENTS_FILE);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function readStateFile(path: string): HarnessState {
  if (!existsSync(path)) return createEmptyHarnessState();
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as HarnessState;
    if (!raw.entries) return createEmptyHarnessState();
    return raw;
  } catch {
    return createEmptyHarnessState();
  }
}

function writeStateAtomic(path: string, state: HarnessState): void {
  const dir = join(path, '..');
  ensureDir(dir);
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
  renameSync(tmp, path);
}

export class HarnessFileStore {
  private dirForScope(scope: HarnessScope, sessionId?: string): string {
    if (scope === 'global') return getGlobalHarnessDir();
    if (!sessionId) throw new Error('sessionId required for local harness scope');
    return getSessionHarnessDir(sessionId);
  }

  readState(scope: HarnessScope, sessionId?: string): HarnessState {
    const dir = this.dirForScope(scope, sessionId);
    return readStateFile(harnessStatePath(dir));
  }

  writeState(scope: HarnessScope, sessionId: string | undefined, state: HarnessState): void {
    state.schema = HARNESS_STATE_SCHEMA_VERSION;
    const dir = this.dirForScope(scope, sessionId);
    writeStateAtomic(harnessStatePath(dir), state);
  }

  listEntries(scope: HarnessScope, sessionId?: string, kind?: HarnessKind): HarnessEntry[] {
    const state = this.readState(scope, sessionId);
    const kinds: HarnessKind[] = kind
      ? [kind]
      : ['prompt', 'memory', 'skill', 'subagent'];
    const out: HarnessEntry[] = [];
    for (const k of kinds) {
      out.push(...Object.values(state.entries[k] ?? {}));
    }
    return out;
  }

  getEntry(
    scope: HarnessScope,
    sessionId: string | undefined,
    kind: HarnessKind,
    id: string,
  ): HarnessEntry | undefined {
    const state = this.readState(scope, sessionId);
    return state.entries[kind]?.[id];
  }

  upsertEntry(
    scope: HarnessScope,
    sessionId: string | undefined,
    entry: HarnessEntry,
  ): HarnessEntry {
    const state = this.readState(scope, sessionId);
    const bucket = state.entries[entry.kind] ?? {};
    bucket[entry.id] = entry;
    state.entries[entry.kind] = bucket;
    this.writeState(scope, sessionId, state);
    return entry;
  }

  deleteEntry(
    scope: HarnessScope,
    sessionId: string | undefined,
    kind: HarnessKind,
    id: string,
  ): boolean {
    const state = this.readState(scope, sessionId);
    const bucket = state.entries[kind];
    if (!bucket?.[id]) return false;
    delete bucket[id];
    this.writeState(scope, sessionId, state);
    return true;
  }

  appendRefinement(
    scope: HarnessScope,
    sessionId: string | undefined,
    event: HarnessRefinementEvent,
  ): void {
    const dir = this.dirForScope(scope, sessionId);
    ensureDir(dir);
    const state = this.readState(scope, sessionId);
    state.refinements.push(event);
    this.writeState(scope, sessionId, state);
    appendFileSync(refinementsPath(dir), `${JSON.stringify(event)}\n`, 'utf-8');
  }

  listRefinements(scope: HarnessScope, sessionId?: string): HarnessRefinementEvent[] {
    return this.readState(scope, sessionId).refinements;
  }

  cloneState(scope: HarnessScope, sessionId?: string): HarnessState {
    return structuredClone(this.readState(scope, sessionId));
  }

  applyEdit(
    scope: HarnessScope,
    sessionId: string | undefined,
    action: RefinementAction,
    kind: HarnessKind,
    patch: Partial<HarnessEntry> & { id?: string },
  ): HarnessEntry | null {
    const now = new Date().toISOString();
    if (action === 'delete') {
      if (!patch.id) return null;
      this.deleteEntry(scope, sessionId, kind, patch.id);
      return null;
    }

    const state = this.readState(scope, sessionId);
    const bucket = state.entries[kind] ?? {};
    const id = patch.id ?? randomUUID();
    const existing = bucket[id];
    const entry: HarnessEntry = {
      id,
      kind,
      title: patch.title ?? existing?.title ?? '',
      content: patch.content ?? existing?.content ?? '',
      path: patch.path ?? existing?.path ?? '',
      scope,
      reference: patch.reference ?? existing?.reference ?? {},
      arguments: patch.arguments ?? existing?.arguments ?? {},
      metadata: patch.metadata ?? existing?.metadata ?? {},
      source: patch.source ?? existing?.source ?? 'refine',
      created_at: existing?.created_at ?? now,
      updated_at: now,
      version: (existing?.version ?? 0) + 1,
    };
    bucket[id] = entry;
    state.entries[kind] = bucket;
    this.writeState(scope, sessionId, state);
    return entry;
  }
}
