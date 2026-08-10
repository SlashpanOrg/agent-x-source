import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Pool } from 'pg';
import type { GoalBudget, GoalState } from '@agentx/shared';
import { createIdleGoalState } from '@agentx/shared';
import { getSessionGoalPath } from '../harness/paths.js';
import { getAdoptionDbPool } from '../adoption/adoption-db.js';

export class GoalFileStore {
  read(sessionId: string): GoalState {
    const path = getSessionGoalPath(sessionId);
    if (!existsSync(path)) return createIdleGoalState();
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as GoalState;
    } catch {
      return createIdleGoalState();
    }
  }

  write(sessionId: string, state: GoalState): void {
    const path = getSessionGoalPath(sessionId);
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    state.updatedAt = new Date().toISOString();
    writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8');
  }
}

export class GoalPostgresStore {
  constructor(private readonly pool: Pool) {}

  async read(sessionId: string): Promise<GoalState> {
    const res = await this.pool.query(`SELECT * FROM session_goals WHERE session_id = $1`, [sessionId]);
    if (!res.rows.length) return createIdleGoalState();
    const row = res.rows[0] as Record<string, unknown>;
    return {
      status: row.status as GoalState['status'],
      objective: String(row.objective ?? ''),
      progress: (row.progress as Record<string, unknown>) ?? {},
      budget: (row.budget as GoalBudget) ?? {},
      continuationsUsed: Number(row.continuations_used ?? 0),
      tokensUsed: Number(row.tokens_used ?? 0),
      startedAt: row.started_at ? String(row.started_at) : undefined,
      completedAt: row.completed_at ? String(row.completed_at) : undefined,
      error: row.error ? String(row.error) : undefined,
      updatedAt: String(row.updated_at),
    };
  }

  async write(sessionId: string, state: GoalState): Promise<void> {
    await this.pool.query(
      `INSERT INTO session_goals (session_id, status, objective, progress, budget, continuations_used, tokens_used, started_at, completed_at, error, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
       ON CONFLICT (session_id) DO UPDATE SET
         status = EXCLUDED.status, objective = EXCLUDED.objective, progress = EXCLUDED.progress,
         budget = EXCLUDED.budget, continuations_used = EXCLUDED.continuations_used,
         tokens_used = EXCLUDED.tokens_used, started_at = EXCLUDED.started_at,
         completed_at = EXCLUDED.completed_at, error = EXCLUDED.error, updated_at = NOW()`,
      [
        sessionId,
        state.status,
        state.objective,
        JSON.stringify(state.progress ?? {}),
        JSON.stringify(state.budget ?? {}),
        state.continuationsUsed,
        state.tokensUsed,
        state.startedAt ?? null,
        state.completedAt ?? null,
        state.error ?? null,
      ],
    );
  }
}

export class GoalStore {
  private readonly fileStore = new GoalFileStore();
  private postgres: GoalPostgresStore | null = null;

  private pg(): GoalPostgresStore | null {
    const pool = getAdoptionDbPool();
    if (!pool) return null;
    if (!this.postgres) this.postgres = new GoalPostgresStore(pool);
    return this.postgres;
  }

  read(sessionId: string): GoalState {
    const pg = this.pg();
    if (pg) {
      // Sync callers use file; async path via readAsync
      return this.fileStore.read(sessionId);
    }
    return this.fileStore.read(sessionId);
  }

  async readAsync(sessionId: string): Promise<GoalState> {
    const pg = this.pg();
    if (pg) return pg.read(sessionId);
    return this.fileStore.read(sessionId);
  }

  write(sessionId: string, state: GoalState): void {
    this.fileStore.write(sessionId, state);
    const pg = this.pg();
    if (pg) {
      void pg.write(sessionId, state).catch(() => {});
    }
  }

  async writeAsync(sessionId: string, state: GoalState): Promise<void> {
    this.fileStore.write(sessionId, state);
    const pg = this.pg();
    if (pg) await pg.write(sessionId, state);
  }
}
