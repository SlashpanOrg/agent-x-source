import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  HarnessEntry,
  HarnessKind,
  HarnessRefinementEvent,
  HarnessScope,
  HarnessState,
  RefinementAction,
} from '@agentx/shared';
import { createEmptyHarnessState, HARNESS_STATE_SCHEMA_VERSION } from '@agentx/shared';

function rowToEntry(row: Record<string, unknown>): HarnessEntry {
  return {
    id: String(row.id),
    kind: row.kind as HarnessKind,
    title: String(row.title ?? ''),
    content: String(row.content ?? ''),
    path: String(row.path ?? ''),
    scope: row.scope as HarnessScope,
    reference: (row.reference as HarnessEntry['reference']) ?? {},
    arguments: (row.arguments as HarnessEntry['arguments']) ?? {},
    metadata: (row.metadata as HarnessEntry['metadata']) ?? {},
    source: String(row.source ?? ''),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    version: Number(row.version ?? 1),
  };
}

function stateFromRows(rows: HarnessEntry[]): HarnessState {
  const state = createEmptyHarnessState();
  for (const entry of rows) {
    const bucket = state.entries[entry.kind] ?? {};
    bucket[entry.id] = entry;
    state.entries[entry.kind] = bucket;
  }
  return state;
}

export class HarnessPostgresStore {
  constructor(private readonly pool: Pool) {}

  async readState(scope: HarnessScope, sessionId?: string): Promise<HarnessState> {
    const rows = await this.listEntryRows(scope, sessionId);
    const state = stateFromRows(rows);
    const refinements = await this.listRefinements(scope, sessionId);
    state.refinements = refinements;
    return state;
  }

  private async listEntryRows(scope: HarnessScope, sessionId?: string): Promise<HarnessEntry[]> {
    const res = scope === 'global'
      ? await this.pool.query(
          `SELECT * FROM harness_entries WHERE scope = 'global' ORDER BY updated_at`,
        )
      : await this.pool.query(
          `SELECT * FROM harness_entries WHERE scope = 'local' AND session_id = $1 ORDER BY updated_at`,
          [sessionId],
        );
    return res.rows.map((r) => rowToEntry(r as Record<string, unknown>));
  }

  async listEntries(scope: HarnessScope, sessionId?: string, kind?: HarnessKind): Promise<HarnessEntry[]> {
    const entries = await this.listEntryRows(scope, sessionId);
    if (!kind) return entries;
    return entries.filter((e) => e.kind === kind);
  }

  async upsertEntry(scope: HarnessScope, sessionId: string | undefined, entry: HarnessEntry): Promise<HarnessEntry> {
    await this.pool.query(
      `INSERT INTO harness_entries (id, session_id, scope, kind, title, content, path, reference, arguments, metadata, source, version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, content = EXCLUDED.content, path = EXCLUDED.path,
         reference = EXCLUDED.reference, arguments = EXCLUDED.arguments, metadata = EXCLUDED.metadata,
         source = EXCLUDED.source, version = EXCLUDED.version, updated_at = EXCLUDED.updated_at`,
      [
        entry.id,
        scope === 'local' ? sessionId : null,
        scope,
        entry.kind,
        entry.title,
        entry.content,
        entry.path,
        JSON.stringify(entry.reference ?? {}),
        JSON.stringify(entry.arguments ?? {}),
        JSON.stringify(entry.metadata ?? {}),
        entry.source,
        entry.version,
        entry.created_at,
        entry.updated_at,
      ],
    );
    return entry;
  }

  async deleteEntry(scope: HarnessScope, sessionId: string | undefined, kind: HarnessKind, id: string): Promise<boolean> {
    const res = await this.pool.query(
      `DELETE FROM harness_entries WHERE id = $1 AND scope = $2 AND ($3::text IS NULL OR session_id = $3) AND kind = $4`,
      [id, scope, scope === 'local' ? sessionId : null, kind],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async appendRefinement(
    scope: HarnessScope,
    sessionId: string | undefined,
    event: HarnessRefinementEvent,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO harness_refinements (id, session_id, scope, trigger, changes, evidence, outcome, rollback_id, before_snapshot, after_snapshot, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        event.id,
        scope === 'local' ? sessionId : null,
        scope,
        event.trigger,
        JSON.stringify(event.changes),
        event.evidence ?? '',
        event.outcome ?? '',
        event.rollback_id ?? null,
        JSON.stringify(event.before_snapshot ?? null),
        JSON.stringify(event.after_snapshot ?? null),
        event.created_at,
      ],
    );
  }

  async listRefinements(scope: HarnessScope, sessionId?: string): Promise<HarnessRefinementEvent[]> {
    const res = scope === 'global'
      ? await this.pool.query(
          `SELECT * FROM harness_refinements WHERE scope = 'global' ORDER BY created_at`,
        )
      : await this.pool.query(
          `SELECT * FROM harness_refinements WHERE scope = 'local' AND session_id = $1 ORDER BY created_at`,
          [sessionId],
        );
    return res.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id),
        trigger: String(r.trigger ?? ''),
        changes: (r.changes as string[]) ?? [],
        evidence: String(r.evidence ?? ''),
        outcome: String(r.outcome ?? ''),
        rollback_id: r.rollback_id ? String(r.rollback_id) : undefined,
        before_snapshot: r.before_snapshot as HarnessRefinementEvent['before_snapshot'],
        after_snapshot: r.after_snapshot as HarnessRefinementEvent['after_snapshot'],
        created_at: String(r.created_at),
      };
    });
  }

  async cloneState(scope: HarnessScope, sessionId?: string): Promise<HarnessState> {
    const state = await this.readState(scope, sessionId);
    state.schema = HARNESS_STATE_SCHEMA_VERSION;
    return structuredClone(state);
  }

  async applyEdit(
    scope: HarnessScope,
    sessionId: string | undefined,
    action: RefinementAction,
    kind: HarnessKind,
    patch: Partial<HarnessEntry> & { id?: string },
  ): Promise<HarnessEntry | null> {
    const now = new Date().toISOString();
    if (action === 'delete') {
      if (!patch.id) return null;
      await this.deleteEntry(scope, sessionId, kind, patch.id);
      return null;
    }
    const entries = await this.listEntries(scope, sessionId, kind);
    const existing = patch.id ? entries.find((e) => e.id === patch.id) : undefined;
    const id = patch.id ?? randomUUID();
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
    await this.upsertEntry(scope, sessionId, entry);
    return entry;
  }
}
