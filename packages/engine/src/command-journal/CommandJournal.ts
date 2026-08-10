import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { CommandJournalEntry, CommandJournalStatus } from '@agentx/shared';
import { isDurableTurnsEnabled } from '@agentx/shared';
import { getAdoptionDbPool } from '../adoption/adoption-db.js';
import { incrementAdoptionMetric } from '../adoption/adoption-metrics.js';

export class CommandJournal {
  isEnabled(): boolean {
    return isDurableTurnsEnabled();
  }

  private pool(): Pool | null {
    return getAdoptionDbPool();
  }

  async receive(
    commandType: string,
    sessionId: string | null,
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<CommandJournalEntry> {
    const existing = await this.getByKey(idempotencyKey);
    if (existing) return existing;

    const id = randomUUID();
    const entry: CommandJournalEntry = {
      id,
      idempotencyKey,
      commandType,
      sessionId: sessionId ?? undefined,
      payload,
      status: 'received',
      receivedAt: new Date().toISOString(),
    };
    const pool = this.pool();
    if (pool && this.isEnabled()) {
      await pool.query(
        `INSERT INTO command_journal (id, idempotency_key, command_type, session_id, payload, status, received_at)
         VALUES ($1,$2,$3,$4,$5,'received',NOW())
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [id, idempotencyKey, commandType, sessionId, JSON.stringify(payload)],
      );
      const again = await this.getByKey(idempotencyKey);
      if (again) return again;
    }
    return entry;
  }

  async recordCompleted(idempotencyKey: string, result: Record<string, unknown>): Promise<void> {
    return this.complete(idempotencyKey, result);
  }

  async recordFailed(idempotencyKey: string, error: string): Promise<void> {
    return this.fail(idempotencyKey, error);
  }

  /** Startup sweep: received commands from prior process → uncertain (never auto-replay). */
  async sweepUncertain(): Promise<number> {
    const pool = this.pool();
    if (!pool || !this.isEnabled()) return 0;
    const res = await pool.query(
      `UPDATE command_journal SET status = 'uncertain', updated_at = NOW()
       WHERE status = 'received'`,
    );
    const count = res.rowCount ?? 0;
    if (count > 0) incrementAdoptionMetric('command_journal_uncertain_total', count);
    return count;
  }

  async complete(idempotencyKey: string, result: Record<string, unknown>): Promise<void> {
    const pool = this.pool();
    if (!pool || !this.isEnabled()) return;
    await pool.query(
      `UPDATE command_journal SET status = 'completed', result = $2, completed_at = NOW() WHERE idempotency_key = $1`,
      [idempotencyKey, JSON.stringify(result)],
    );
  }

  async fail(idempotencyKey: string, error: string): Promise<void> {
    const pool = this.pool();
    if (!pool || !this.isEnabled()) return;
    await pool.query(
      `UPDATE command_journal SET status = 'failed', error = $2, completed_at = NOW() WHERE idempotency_key = $1`,
      [idempotencyKey, error],
    );
  }

  async getByKey(idempotencyKey: string): Promise<CommandJournalEntry | null> {
    const pool = this.pool();
    if (!pool || !this.isEnabled()) return null;
    const res = await pool.query(`SELECT * FROM command_journal WHERE idempotency_key = $1`, [idempotencyKey]);
    if (!res.rows.length) return null;
    const row = res.rows[0] as Record<string, unknown>;
    return {
      id: String(row.id),
      idempotencyKey: String(row.idempotency_key),
      commandType: String(row.command_type),
      sessionId: row.session_id ? String(row.session_id) : undefined,
      payload: (row.payload as Record<string, unknown>) ?? {},
      status: row.status as CommandJournalStatus,
      result: row.result as Record<string, unknown> | undefined,
      error: row.error ? String(row.error) : undefined,
      receivedAt: String(row.received_at),
      completedAt: row.completed_at ? String(row.completed_at) : undefined,
    };
  }
}

let journal: CommandJournal | null = null;

export function getCommandJournal(): CommandJournal {
  if (!journal) journal = new CommandJournal();
  return journal;
}
