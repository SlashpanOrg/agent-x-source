import type { Pool } from 'pg';
import { isWsGenerationReplayEnabled } from '@agentx/shared';
import { getAdoptionDbPool } from '../adoption/adoption-db.js';
import { incrementAdoptionMetric } from '../adoption/adoption-metrics.js';
import { getSessionEventLog } from './SessionEventLog.js';

export interface SessionEventEnvelope {
  generation: number;
  sequence: number;
  payload: Record<string, unknown>;
}

let instance: SessionGenerationManager | null = null;

export function getSessionGenerationManager(): SessionGenerationManager {
  if (!instance) instance = new SessionGenerationManager();
  return instance;
}

export class SessionGenerationManager {
  private readonly sequences = new Map<string, number>();

  isEnabled(): boolean {
    return isWsGenerationReplayEnabled();
  }

  private pool(): Pool | null {
    return getAdoptionDbPool();
  }

  /** Monotonic sequence within the current generation (does not bump generation). */
  async nextEnvelope(sessionId: string, payload: Record<string, unknown>): Promise<SessionEventEnvelope> {
    const sequence = (this.sequences.get(sessionId) ?? 0) + 1;
    this.sequences.set(sessionId, sequence);
    const generation = await this.getGeneration(sessionId);
    const envelope: SessionEventEnvelope = { generation, sequence, payload };
    getSessionEventLog().record(sessionId, envelope);
    return envelope;
  }

  /** Explicit generation bump — invalidates prior sequences (reset, compaction, rollback). */
  async bumpGeneration(sessionId: string, reason?: string): Promise<number> {
    incrementAdoptionMetric('ws_generation_bumps_total');
    this.sequences.set(sessionId, 0);
    if (!this.isEnabled()) return 0;
    const pool = this.pool();
    if (!pool) return 0;
    const res = await pool.query(
      `INSERT INTO session_generations (session_id, generation, updated_at)
       VALUES ($1, 1, NOW())
       ON CONFLICT (session_id) DO UPDATE SET
         generation = session_generations.generation + 1,
         updated_at = NOW()
       RETURNING generation`,
      [sessionId],
    );
    const generation = Number((res.rows[0] as { generation?: number })?.generation ?? 1);
    if (reason) {
      void this.nextEnvelope(sessionId, { type: 'generation_bump', reason });
    }
    return generation;
  }

  async getGeneration(sessionId: string): Promise<number> {
    const pool = this.pool();
    if (!pool || !this.isEnabled()) return 0;
    const res = await pool.query(`SELECT generation FROM session_generations WHERE session_id = $1`, [sessionId]);
    if (!res.rows.length) {
      await pool.query(
        `INSERT INTO session_generations (session_id, generation, updated_at) VALUES ($1, 0, NOW()) ON CONFLICT DO NOTHING`,
        [sessionId],
      );
      return 0;
    }
    return Number((res.rows[0] as { generation?: number })?.generation ?? 0);
  }

  wrap(sessionId: string, payload: Record<string, unknown>): Promise<SessionEventEnvelope> {
    return this.nextEnvelope(sessionId, payload);
  }

  async getEventsSince(sessionId: string, generation: number, afterSequence = 0): Promise<SessionEventEnvelope[]> {
    const rows = await getSessionEventLog().getSinceAsync(sessionId, generation, afterSequence);
    return rows.map((r) => ({ generation: r.generation, sequence: r.sequence, payload: r.payload }));
  }
}
