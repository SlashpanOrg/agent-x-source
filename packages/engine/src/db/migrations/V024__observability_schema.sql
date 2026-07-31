-- Observability schema: traces, spans, logs, metric samples, config.
-- Stored in the same embedded Postgres as the core schema; isolated in its own schema namespace.
--
-- DOMAIN SEGREGATION: every row is tagged with `domain` ∈ ('APP','AGENT'):
--   AGENT = AI/LLM turn lifecycle (turns, journey, llm calls, tool decisions/executions, crew, retrieval)
--   APP   = normal application operations (HTTP requests, auth, DB queries, WebSocket, channels, automation, startup, integrations)
-- This lets the UI filter "show me only agent issues" vs "show me only app issues" vs "both" with one toggle.

CREATE SCHEMA IF NOT EXISTS observability;

-- 1. TRACES — one row per turn (AGENT) or per app request/operation (APP)
CREATE TABLE IF NOT EXISTS observability.traces (
  trace_id        TEXT PRIMARY KEY,
  root_span_id    TEXT NOT NULL,
  domain          TEXT NOT NULL CHECK(domain IN ('APP','AGENT')) DEFAULT 'AGENT',
  kind            TEXT NOT NULL,   -- AGENT: 'turn','autonomous_run','crew_mission','task_executor'
                                  -- APP:   'http_request','ws_connection','auth','db_query','channel_event','automation_run','startup','integration_call','job'
  session_id      TEXT,
  turn_id         TEXT,
  user_text       TEXT,
  status          TEXT NOT NULL CHECK(status IN ('running','ok','error','cancelled')),
  error           TEXT,
  started_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ,
  duration_ms     INTEGER,
  provider        TEXT,
  model           TEXT,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  cost_usd        NUMERIC(12,6) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_traces_session_started ON observability.traces (session_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_traces_status_started ON observability.traces (status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_traces_kind_started ON observability.traces (kind, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_traces_domain_started ON observability.traces (domain, started_at DESC);

-- 2. SPANS — the tree (llm, tool, tool_decision, journey_stage, agent, retrieval, internal)
--    For APP traces, kinds are: 'http','ws','auth','db','channel','automation','integration','job','internal'
CREATE TABLE IF NOT EXISTS observability.spans (
  span_id         TEXT PRIMARY KEY,
  trace_id        TEXT NOT NULL REFERENCES observability.traces(trace_id) ON DELETE CASCADE,
  parent_span_id  TEXT,
  domain          TEXT NOT NULL CHECK(domain IN ('APP','AGENT')) DEFAULT 'AGENT',
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL,   -- AGENT: 'llm','tool','tool_decision','journey_stage','agent','retrieval','internal'
                                  -- APP:   'http','ws','auth','db','channel','automation','integration','job','internal'
  status          TEXT NOT NULL CHECK(status IN ('ok','error','unset')),
  started_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ,
  duration_ms     INTEGER,
  attributes      JSONB NOT NULL DEFAULT '{}'::jsonb,
  events          JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_spans_trace_started ON observability.spans (trace_id, started_at);
CREATE INDEX IF NOT EXISTS idx_spans_parent ON observability.spans (parent_span_id);
CREATE INDEX IF NOT EXISTS idx_spans_domain ON observability.spans (domain);

-- 3. LOGS — structured, linked to trace/span, tagged by domain
CREATE TABLE IF NOT EXISTS observability.logs (
  id           BIGSERIAL PRIMARY KEY,
  trace_id     TEXT,
  span_id      TEXT,
  session_id   TEXT,
  domain       TEXT NOT NULL CHECK(domain IN ('APP','AGENT')) DEFAULT 'AGENT',
  ts           TIMESTAMPTZ NOT NULL,
  level        TEXT NOT NULL CHECK(level IN ('debug','info','warn','error')),
  scope        TEXT,
  message      TEXT NOT NULL,
  payload      JSONB
);

CREATE INDEX IF NOT EXISTS idx_logs_trace_ts ON observability.logs (trace_id, ts);
CREATE INDEX IF NOT EXISTS idx_logs_ts ON observability.logs (ts DESC);
CREATE INDEX IF NOT EXISTS idx_logs_session_ts ON observability.logs (session_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_logs_domain_ts ON observability.logs (domain, ts DESC);

-- 4. METRIC SAMPLES — time-series for UI charts, tagged by domain via labels
CREATE TABLE IF NOT EXISTS observability.metric_samples (
  id         BIGSERIAL PRIMARY KEY,
  ts         TIMESTAMPTZ NOT NULL,
  name       TEXT NOT NULL,
  value      DOUBLE PRECISION NOT NULL,
  labels     JSONB NOT NULL DEFAULT '{}'::jsonb  -- includes { "domain": "APP"|"AGENT" }
);

CREATE INDEX IF NOT EXISTS idx_metrics_name_ts ON observability.metric_samples (name, ts DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_domain_ts ON observability.metric_samples ((labels->>'domain'), ts DESC);

-- 5. CONFIG — single row (id=1)
CREATE TABLE IF NOT EXISTS observability.config (
  id              INT PRIMARY KEY DEFAULT 1 CHECK(id = 1),
  retention_days  INT NOT NULL DEFAULT 30 CHECK(retention_days BETWEEN 1 AND 90),
  capture_prompts BOOLEAN NOT NULL DEFAULT TRUE,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO observability.config (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;
