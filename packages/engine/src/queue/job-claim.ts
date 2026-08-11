/**
 * Shared claim-before-deliver helper for Postgres-backed job rows.
 */

export const DEFAULT_JOB_CLAIM_TTL_MS = 5 * 60 * 1000;

export type JobClaimFailure = 'held_by_other' | 'inactive' | 'not_found';

export interface JobClaimResult {
  ok: boolean;
  reason?: JobClaimFailure;
}

export interface JobClaimPool {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rowCount: number | null; rows?: unknown[] }>;
}

export async function tryClaimAutomationTask(
  pool: JobClaimPool,
  taskId: string,
  claimHolder: string,
  ttlMs = DEFAULT_JOB_CLAIM_TTL_MS,
): Promise<JobClaimResult> {
  const res = await pool.query(
    `UPDATE automation_tasks
     SET claimed_at = NOW(), claimed_by = $2, updated_at = NOW()
     WHERE id = $1
       AND status = 'active'
       AND (
         claimed_at IS NULL
         OR claimed_at < NOW() - ($3::double precision / 1000.0) * INTERVAL '1 second'
       )`,
    [taskId, claimHolder, ttlMs],
  );
  if ((res.rowCount ?? 0) > 0) return { ok: true };

  const exists = await pool.query(
    `SELECT status FROM automation_tasks WHERE id = $1 LIMIT 1`,
    [taskId],
  );
  if ((exists.rowCount ?? 0) === 0) return { ok: false, reason: 'not_found' };
  const status = (exists.rows?.[0] as { status?: string } | undefined)?.status;
  if (status !== 'active') return { ok: false, reason: 'inactive' };
  return { ok: false, reason: 'held_by_other' };
}

export async function releaseAutomationTaskClaim(
  pool: JobClaimPool,
  taskId: string,
  claimHolder: string,
): Promise<void> {
  await pool.query(
    `UPDATE automation_tasks
     SET claimed_at = NULL, claimed_by = NULL, updated_at = NOW()
     WHERE id = $1 AND claimed_by = $2`,
    [taskId, claimHolder],
  );
}
