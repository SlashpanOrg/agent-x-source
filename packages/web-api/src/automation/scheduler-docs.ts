/**
 * Dual pg-boss topology (Phase 3 scheduler hardening).
 *
 * 1. `web-api/src/automation/boss.ts` — automation scheduled runs (`automation-run` queue).
 * 2. `engine/src/queue/PgBossQueue.ts` — general engine job queue (API `/api/jobs`).
 *
 * Both use schema `pgboss` but serve different workloads. Retry policy is aligned:
 * retryLimit=3, retryDelay=60s, retryBackoff=true, expireInHours=23.
 *
 * Automation uses claim-before-deliver on `automation_tasks` (claimed_at/claimed_by)
 * with TTL from `engine/queue/job-claim.ts`. Engine PgBossQueue handlers should treat
 * job expiration as implicit claim TTL (expireInHours).
 *
 * Heartbeat surfaces:
 * - User schedule: automation_tasks + pg-boss one-shot/recurring lead-time jobs
 * - Agent schedule: Scheduler.ts in engine (in-process timers)
 * - CLI schedule: `scripts/agent-x-send.mjs` → REST agent-message (manual steer/auto)
 *
 * Goal continuations: automation runs use dedicated automation sessions; goal continuation
 * prompts are disabled for automationRun agents — no duplicate host prompts.
 */

export const SCHEDULER_HARDENING_NOTES = true;
