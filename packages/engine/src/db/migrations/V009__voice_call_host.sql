-- Host / VOIP call domain (HOST_VOICE_ACCESS_PLAN H4)

CREATE TABLE IF NOT EXISTS voice_call_missions (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  provider_id TEXT NOT NULL,
  phone_number_id TEXT NOT NULL,
  recipient_e164 TEXT,
  purpose TEXT NOT NULL,
  system_context TEXT,
  allowed_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  forbidden_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  allowed_tool_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  require_confirmation_for JSONB NOT NULL DEFAULT '[]'::jsonb,
  max_duration_seconds INTEGER NOT NULL DEFAULT 600,
  max_cost_minor_units INTEGER,
  recording TEXT NOT NULL DEFAULT 'off',
  ai_disclosure TEXT NOT NULL DEFAULT 'required',
  escalation JSONB NOT NULL DEFAULT '{}'::jsonb,
  stop_conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_call_missions_status
  ON voice_call_missions(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS voice_call_sessions (
  id TEXT PRIMARY KEY,
  mission_id TEXT REFERENCES voice_call_missions(id) ON DELETE SET NULL,
  provider_id TEXT NOT NULL,
  provider_call_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  state TEXT NOT NULL DEFAULT 'created',
  from_e164_redacted TEXT,
  to_e164_redacted TEXT,
  phone_number_id TEXT,
  idempotency_key TEXT,
  cost_minor_units INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  outcome TEXT,
  outcome_summary TEXT,
  recording_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_call_sessions_provider_call
  ON voice_call_sessions(provider_id, provider_call_id)
  WHERE provider_call_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_call_sessions_idempotency
  ON voice_call_sessions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_voice_call_sessions_state
  ON voice_call_sessions(state, updated_at DESC);

CREATE TABLE IF NOT EXISTS voice_call_events (
  id TEXT PRIMARY KEY,
  call_session_id TEXT NOT NULL REFERENCES voice_call_sessions(id) ON DELETE CASCADE,
  provider_event_id TEXT,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_call_events_provider_event
  ON voice_call_events(call_session_id, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_voice_call_events_session
  ON voice_call_events(call_session_id, occurred_at ASC);

CREATE TABLE IF NOT EXISTS voice_call_consents (
  id TEXT PRIMARY KEY,
  e164_hash TEXT NOT NULL,
  e164_redacted TEXT NOT NULL,
  consent_type TEXT NOT NULL,
  granted BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_call_consents_hash
  ON voice_call_consents(e164_hash, consent_type);

CREATE TABLE IF NOT EXISTS voice_call_provider_bindings (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  provider_number_id TEXT,
  e164 TEXT,
  e164_redacted TEXT,
  label TEXT,
  inbound_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  outbound_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_call_bindings_provider
  ON voice_call_provider_bindings(provider_id);

CREATE TABLE IF NOT EXISTS host_security_events (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_host_security_events_created
  ON host_security_events(created_at DESC);
