import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { isWsGenerationReplayEnabled } from '@agentx/shared';
import { getAdoptionDbPool } from '../adoption/adoption-db.js';
import type { SessionEventEnvelope } from './SessionGenerationManager.js';

const MAX_IN_MEMORY = 500;

interface StoredEvent {
  generation: number;
  sequence: number;
  payload: Record<string, unknown>;
  createdAt: string;
}

export class SessionEventLog {
  private readonly buffers = new Map<string, StoredEvent[]>();

  isEnabled(): boolean {
    return isWsGenerationReplayEnabled();
  }

  private pool(): Pool | null {
    return getAdoptionDbPool();
  }

  record(sessionId: string, envelope: SessionEventEnvelope): void {
    if (!sessionId) return;
    const entry: StoredEvent = {
      generation: envelope.generation,
      sequence: envelope.sequence,
      payload: envelope.payload,
      createdAt: new Date().toISOString(),
    };
    const buf = this.buffers.get(sessionId) ?? [];
    buf.push(entry);
    if (buf.length > MAX_IN_MEMORY) buf.splice(0, buf.length - MAX_IN_MEMORY);
    this.buffers.set(sessionId, buf);

    const pool = this.pool();
    if (!pool || !this.isEnabled()) return;
    void pool.query(
      `INSERT INTO session_events (id, session_id, generation, sequence, payload, created_at)
       VALUES ($1,$2,$3,$4,$5,NOW())`,
      [randomUUID(), sessionId, envelope.generation, envelope.sequence, JSON.stringify(envelope.payload)],
    ).catch(() => { /* best-effort */ });
  }

  getSince(sessionId: string, generation: number, afterSequence = 0): StoredEvent[] {
    const mem = (this.buffers.get(sessionId) ?? []).filter(
      (e) => e.generation === generation && e.sequence > afterSequence,
    );
    return mem;
  }

  async getSinceAsync(sessionId: string, generation: number, afterSequence = 0): Promise<StoredEvent[]> {
    const mem = this.getSince(sessionId, generation, afterSequence);
    if (mem.length > 0) return mem;
    const pool = this.pool();
    if (!pool || !this.isEnabled()) return [];
    const res = await pool.query(
      `SELECT generation, sequence, payload, created_at FROM session_events
       WHERE session_id = $1 AND generation = $2 AND sequence > $3
       ORDER BY sequence ASC LIMIT 500`,
      [sessionId, generation, afterSequence],
    );
    return res.rows.map((row) => ({
      generation: Number(row.generation),
      sequence: Number(row.sequence),
      payload: (row.payload as Record<string, unknown>) ?? {},
      createdAt: String(row.created_at),
    }));
  }
}

let log: SessionEventLog | null = null;

export function getSessionEventLog(): SessionEventLog {
  if (!log) log = new SessionEventLog();
  return log;
}
