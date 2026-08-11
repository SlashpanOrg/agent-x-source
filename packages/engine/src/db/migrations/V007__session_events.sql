-- Session event log for WS generation replay (Prime Agent adoption Phase 2)
-- session_events already exists from V001 (event_type + TEXT payload); extend it.

ALTER TABLE session_events
  ADD COLUMN IF NOT EXISTS generation INTEGER NOT NULL DEFAULT 0;

-- Adoption replay rows omit event_type; legacy rows keep event_type populated.
ALTER TABLE session_events
  ALTER COLUMN event_type DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_session_events_replay
  ON session_events(session_id, generation, sequence);
