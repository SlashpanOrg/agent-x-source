import type { Pool } from 'pg';
import { isResidentSessionsEnabled, getLogger } from '@agentx/shared';
import type { Agent } from '../agent/Agent.js';
import { getAdoptionDbPool } from '../adoption/adoption-db.js';

export type ResidentSessionStatus = 'active' | 'detached';

export interface ResidentSessionRecord {
  sessionId: string;
  status: ResidentSessionStatus;
  detachedAt?: string;
  lastActivityAt: string;
  idleTimeoutMs: number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 86_400_000;

export class ResidentSessionManager {
  private readonly residents = new Map<string, { agent: Agent; status: ResidentSessionStatus }>();

  isEnabled(): boolean {
    return isResidentSessionsEnabled();
  }

  register(sessionId: string, agent: Agent, status: ResidentSessionStatus = 'active'): void {
    if (!this.isEnabled()) return;
    this.residents.set(sessionId, { agent, status });
    void this.persist(sessionId, status);
    this.startIdleSweep();
  }

  getAgent(sessionId: string): Agent | undefined {
    return this.residents.get(sessionId)?.agent;
  }

  isResident(sessionId: string): boolean {
    return this.residents.has(sessionId);
  }

  async detach(sessionId: string): Promise<boolean> {
    if (!this.isEnabled()) return false;
    const entry = this.residents.get(sessionId);
    if (!entry) return false;
    entry.status = 'detached';
    await this.persist(sessionId, 'detached');
    getLogger().info('RESIDENT', `Detached session ${sessionId}`);
    return true;
  }

  async attach(sessionId: string): Promise<Agent | undefined> {
    if (!this.isEnabled()) return undefined;
    const entry = this.residents.get(sessionId);
    if (!entry) return undefined;
    entry.status = 'active';
    await this.persist(sessionId, 'active');
    getLogger().info('RESIDENT', `Reattached session ${sessionId}`);
    return entry.agent;
  }

  list(): ResidentSessionRecord[] {
    const memory = [...this.residents.entries()].map(([sessionId, entry]) => ({
      sessionId,
      status: entry.status,
      detachedAt: entry.status === 'detached' ? new Date().toISOString() : undefined,
      lastActivityAt: new Date().toISOString(),
      idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
    }));
    return memory;
  }

  /** Evict detached residents idle past timeout (default 24h). */
  async sweepIdleResidents(): Promise<number> {
    if (!this.isEnabled()) return 0;
    const pool = this.pool();
    if (!pool) return 0;
    const res = await pool.query(
      `DELETE FROM resident_sessions
       WHERE status = 'detached'
         AND last_activity_at < NOW() - (idle_timeout_ms * INTERVAL '1 millisecond')`,
    );
    const count = res.rowCount ?? 0;
    if (count > 0) {
      for (const [sessionId, entry] of this.residents.entries()) {
        if (entry.status === 'detached') this.residents.delete(sessionId);
      }
      getLogger().info('RESIDENT', `Swept ${count} idle detached session(s)`);
    }
    return count;
  }

  startIdleSweep(intervalMs = 60_000): void {
    if (!this.isEnabled() || this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      void this.sweepIdleResidents();
    }, intervalMs);
  }

  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  touch(sessionId: string): void {
    if (!this.residents.has(sessionId)) return;
    void this.pool()?.query(
      `UPDATE resident_sessions SET last_activity_at = NOW() WHERE session_id = $1`,
      [sessionId],
    ).catch(() => { /* best-effort */ });
  }

  async recoverOnBoot(agentsBySession: Map<string, Agent>): Promise<void> {
    if (!this.isEnabled()) return;
    const pool = this.pool();
    if (!pool) return;
    try {
      const res = await pool.query(
        `SELECT session_id, status FROM resident_sessions WHERE status IN ('active', 'detached')`,
      );
      for (const row of res.rows as Array<{ session_id: string; status: string }>) {
        const agent = agentsBySession.get(row.session_id);
        if (!agent) continue;
        this.residents.set(row.session_id, {
          agent,
          status: row.status === 'detached' ? 'detached' : 'active',
        });
      }
      getLogger().info('RESIDENT', `Recovered ${this.residents.size} resident session(s)`);
    } catch (e) {
      getLogger().warn('RESIDENT', e instanceof Error ? e.message : String(e));
    }
  }

  private pool(): Pool | null {
    return getAdoptionDbPool();
  }

  private async persist(sessionId: string, status: ResidentSessionStatus): Promise<void> {
    const pool = this.pool();
    if (!pool) return;
    await pool.query(
      `INSERT INTO resident_sessions (session_id, status, detached_at, last_activity_at, idle_timeout_ms)
       VALUES ($1, $2, CASE WHEN $2 = 'detached' THEN NOW() ELSE NULL END, NOW(), $3)
       ON CONFLICT (session_id) DO UPDATE SET
         status = EXCLUDED.status,
         detached_at = CASE WHEN EXCLUDED.status = 'detached' THEN NOW() ELSE resident_sessions.detached_at END,
         last_activity_at = NOW()`,
      [sessionId, status, DEFAULT_IDLE_TIMEOUT_MS],
    );
  }
}

let manager: ResidentSessionManager | null = null;

export function getResidentSessionManager(): ResidentSessionManager {
  if (!manager) manager = new ResidentSessionManager();
  return manager;
}
