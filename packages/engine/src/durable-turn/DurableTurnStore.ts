import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { DurableTurnRecord, DurableTurnStatus } from '@agentx/shared';
import { isDurableTurnsEnabled } from '@agentx/shared';
import { getAdoptionDbPool } from '../adoption/adoption-db.js';

export class DurableTurnStore {
  isEnabled(): boolean {
    return isDurableTurnsEnabled();
  }

  private pool(): Pool | null {
    return getAdoptionDbPool();
  }

  async create(sessionId: string, generation = 0, turnId?: string): Promise<DurableTurnRecord> {
    const id = turnId ?? randomUUID();
    const record: DurableTurnRecord = {
      turnId: id,
      sessionId,
      status: 'queued',
      generation,
      sequence: 0,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const pool = this.pool();
    if (pool && this.isEnabled()) {
      await pool.query(
        `INSERT INTO durable_turns (turn_id, session_id, status, generation, sequence, started_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW(),NOW())`,
        [id, sessionId, record.status, generation, 0],
      );
    }
    return record;
  }

  async updateStatus(turnId: string, status: DurableTurnStatus, partial?: string, error?: string): Promise<void> {
    const pool = this.pool();
    if (!pool || !this.isEnabled()) return;
    await pool.query(
      `UPDATE durable_turns SET status = $2, partial_content = COALESCE($3, partial_content), error = $4, updated_at = NOW(),
         completed_at = CASE WHEN $2 IN ('complete','error','cancelled') THEN NOW() ELSE completed_at END
       WHERE turn_id = $1`,
      [turnId, status, partial ?? null, error ?? null],
    );
  }

  async checkpoint(turnId: string, sequence: number, parts: unknown[], partialContent?: string): Promise<void> {
    const pool = this.pool();
    if (!pool || !this.isEnabled()) return;
    const id = randomUUID();
    await pool.query(
      `INSERT INTO turn_checkpoints (id, turn_id, sequence, parts, partial_content, created_at)
       VALUES ($1,$2,$3,$4,$5,NOW())`,
      [id, turnId, sequence, JSON.stringify(parts), partialContent ?? null],
    );
    await pool.query(`UPDATE durable_turns SET sequence = $2, partial_content = $3, updated_at = NOW() WHERE turn_id = $1`, [
      turnId,
      sequence,
      partialContent ?? null,
    ]);
  }

  async getTurn(turnId: string): Promise<DurableTurnRecord | null> {
    const pool = this.pool();
    if (!pool || !this.isEnabled()) return null;
    const res = await pool.query(`SELECT * FROM durable_turns WHERE turn_id = $1`, [turnId]);
    if (!res.rows.length) return null;
    return this.rowToRecord(res.rows[0] as Record<string, unknown>);
  }

  async getActive(sessionId: string): Promise<DurableTurnRecord | null> {
    const pool = this.pool();
    if (!pool || !this.isEnabled()) return null;
    const res = await pool.query(
      `SELECT * FROM durable_turns WHERE session_id = $1 AND status NOT IN ('complete','error','cancelled') ORDER BY started_at DESC LIMIT 1`,
      [sessionId],
    );
    if (!res.rows.length) return null;
    return this.rowToRecord(res.rows[0] as Record<string, unknown>);
  }

  async listActiveTurns(): Promise<DurableTurnRecord[]> {
    const pool = this.pool();
    if (!pool || !this.isEnabled()) return [];
    const res = await pool.query(
      `SELECT * FROM durable_turns WHERE status NOT IN ('complete','error','cancelled') ORDER BY started_at ASC`,
    );
    return res.rows.map((row) => this.rowToRecord(row as Record<string, unknown>));
  }

  async sweepStaleOnStartup(policy: 'fail_on_stale' | 'attempt_resume' = 'fail_on_stale'): Promise<number> {
    const pool = this.pool();
    if (!pool || !this.isEnabled()) return 0;
    if (policy === 'attempt_resume') return 0;
    const res = await pool.query(
      `UPDATE durable_turns SET status = 'error', error = 'stale_after_restart', updated_at = NOW(), completed_at = NOW()
       WHERE status IN ('queued','running','checkpointed')`,
    );
    return res.rowCount ?? 0;
  }

  private rowToRecord(row: Record<string, unknown>): DurableTurnRecord {
    return {
      turnId: String(row.turn_id),
      sessionId: String(row.session_id),
      status: row.status as DurableTurnStatus,
      generation: Number(row.generation ?? 0),
      sequence: Number(row.sequence ?? 0),
      partialContent: row.partial_content ? String(row.partial_content) : undefined,
      error: row.error ? String(row.error) : undefined,
      startedAt: String(row.started_at),
      updatedAt: String(row.updated_at),
      completedAt: row.completed_at ? String(row.completed_at) : undefined,
    };
  }
}

let store: DurableTurnStore | null = null;

export function getDurableTurnStore(): DurableTurnStore {
  if (!store) store = new DurableTurnStore();
  return store;
}
