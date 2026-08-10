-- Phase 3 scheduler hardening: claim-before-deliver + run records

ALTER TABLE automation_tasks
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_by TEXT;

CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES automation_tasks(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL DEFAULT 'schedule',
  status TEXT NOT NULL,
  coalesced BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_task_started
  ON automation_runs(task_id, started_at DESC);
