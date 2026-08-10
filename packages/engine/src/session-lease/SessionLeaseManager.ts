import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { isSessionLeaseEnabled } from '@agentx/shared';
import { getAdoptionDbPool } from '../adoption/adoption-db.js';
import { incrementAdoptionMetric } from '../adoption/adoption-metrics.js';

function advisoryKey(sessionId: string): number {
  const hash = createHash('sha256').update(sessionId).digest();
  return hash.readInt32BE(0);
}

export class SessionLeaseManager {
  private readonly ownerId: string;

  constructor(ownerNamespace?: string) {
    const suffix = `${process.pid}-${randomUUID().slice(0, 8)}`;
    this.ownerId = ownerNamespace ? `${ownerNamespace}:${suffix}` : `pid-${suffix}`;
  }

  getOwnerId(): string {
    return this.ownerId;
  }

  isEnabled(): boolean {
    return isSessionLeaseEnabled();
  }

  private pool(): Pool | null {
    return getAdoptionDbPool();
  }

  async getHolderOwnerId(sessionId: string): Promise<string | undefined> {
    const pool = this.pool();
    if (!pool) return undefined;
    const res = await pool.query(
      `SELECT owner_id FROM session_leases WHERE session_id = $1 AND expires_at > NOW() LIMIT 1`,
      [sessionId],
    );
    return res.rows.length ? String((res.rows[0] as { owner_id: string }).owner_id) : undefined;
  }

  async acquire(sessionId: string, ttlMs = 120_000): Promise<boolean> {
    if (!this.isEnabled()) return true;
    const pool = this.pool();
    if (!pool) return true;

    const lockKey = advisoryKey(sessionId);
    const lockRes = await pool.query(`SELECT pg_try_advisory_lock($1) AS ok`, [lockKey]);
    const locked = Boolean((lockRes.rows[0] as { ok?: boolean })?.ok);
    if (!locked) {
      incrementAdoptionMetric('session_lease_conflicts_total');
      return false;
    }

    try {
      const expires = new Date(Date.now() + ttlMs).toISOString();
      const res = await pool.query(
        `INSERT INTO session_leases (session_id, owner_id, holder_pid, holder_instance, acquired_at, expires_at)
         VALUES ($1,$2,$3,$4,NOW(),$5)
         ON CONFLICT (session_id) DO UPDATE SET
           owner_id = EXCLUDED.owner_id, holder_pid = EXCLUDED.holder_pid,
           holder_instance = EXCLUDED.holder_instance, acquired_at = NOW(), expires_at = EXCLUDED.expires_at
         WHERE session_leases.expires_at < NOW() OR session_leases.owner_id = $2`,
        [sessionId, this.ownerId, process.pid, this.ownerId, expires],
      );
      const ok = (res.rowCount ?? 0) > 0;
      if (!ok) incrementAdoptionMetric('session_lease_conflicts_total');
      return ok;
    } finally {
      await pool.query(`SELECT pg_advisory_unlock($1)`, [lockKey]);
    }
  }

  async release(sessionId: string): Promise<void> {
    const pool = this.pool();
    if (!pool) return;
    await pool.query(`DELETE FROM session_leases WHERE session_id = $1 AND owner_id = $2`, [sessionId, this.ownerId]);
  }

  async releaseAllOwned(): Promise<void> {
    const pool = this.pool();
    if (!pool) return;
    await pool.query(`DELETE FROM session_leases WHERE owner_id = $1`, [this.ownerId]);
  }

  async renew(sessionId: string, ttlMs = 120_000): Promise<boolean> {
    if (!this.isEnabled()) return true;
    const pool = this.pool();
    if (!pool) return true;
    const expires = new Date(Date.now() + ttlMs).toISOString();
    const res = await pool.query(
      `UPDATE session_leases SET expires_at = $3, acquired_at = NOW()
       WHERE session_id = $1 AND owner_id = $2 AND expires_at > NOW()`,
      [sessionId, this.ownerId, expires],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async isHeld(sessionId: string): Promise<boolean> {
    const pool = this.pool();
    if (!pool) return false;
    const res = await pool.query(
      `SELECT 1 FROM session_leases WHERE session_id = $1 AND expires_at > NOW() LIMIT 1`,
      [sessionId],
    );
    return res.rows.length > 0;
  }
}

const managers = new Map<string, SessionLeaseManager>();

export function getSessionLeaseManager(ownerNamespace?: string): SessionLeaseManager {
  const key = ownerNamespace ?? '__default__';
  let mgr = managers.get(key);
  if (!mgr) {
    mgr = new SessionLeaseManager(ownerNamespace);
    managers.set(key, mgr);
  }
  return mgr;
}

export async function releaseAllSessionLeaseManagers(): Promise<void> {
  await Promise.all([...managers.values()].map((m) => m.releaseAllOwned()));
}
