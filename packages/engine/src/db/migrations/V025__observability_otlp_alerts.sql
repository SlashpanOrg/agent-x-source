-- V025 — Observability: OTLP export, alerting, cost analytics (Phase 11 v1.1+).
--
-- Extends the observability.config table with:
--   * OTLP external collector settings (enable, endpoint, protocol, headers)
--   * Alerting settings (enable, error-rate threshold, latency SLO threshold)
--   * Cost analytics rollup materialized view
--
-- All new columns are nullable/defaulted so existing rows upgrade cleanly.

-- ─── OTLP external collector ────────────────────────────────────────────────
ALTER TABLE observability.config
  ADD COLUMN IF NOT EXISTS otlp_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS otlp_endpoint   TEXT    NOT NULL DEFAULT 'http://localhost:4318/v1/traces',
  ADD COLUMN IF NOT EXISTS otlp_protocol   TEXT    NOT NULL DEFAULT 'http' CHECK(otlp_protocol IN ('http', 'grpc')),
  ADD COLUMN IF NOT EXISTS otlp_headers    JSONB   NOT NULL DEFAULT '{}'::jsonb;

-- ─── Alerting ───────────────────────────────────────────────────────────────
ALTER TABLE observability.config
  ADD COLUMN IF NOT EXISTS alerting_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS alerting_error_rate_pct   INT     NOT NULL DEFAULT 10  CHECK(alerting_error_rate_pct BETWEEN 1 AND 100),
  ADD COLUMN IF NOT EXISTS alerting_latency_p95_ms   INT     NOT NULL DEFAULT 30000 CHECK(alerting_latency_p95_ms BETWEEN 100 AND 600000),
  ADD COLUMN IF NOT EXISTS alerting_window_minutes   INT     NOT NULL DEFAULT 15  CHECK(alerting_window_minutes BETWEEN 1 AND 1440);

-- ─── Cost analytics rollup ──────────────────────────────────────────────────
-- Per-provider, per-model, per-day cost rollup derived from traces.
-- The traces table has `provider` and `model` columns directly (not an
-- `attributes` JSONB column), so we reference them directly.
-- Refreshed on-demand by the API (or a scheduled job).
CREATE MATERIALIZED VIEW IF NOT EXISTS observability.cost_rollup_daily AS
  SELECT
    date_trunc('day', started_at)::date              AS day,
    COALESCE(provider, 'unknown')                    AS provider,
    COALESCE(model, 'unknown')                       AS model,
    domain,
    COUNT(*)                                         AS trace_count,
    SUM(input_tokens)                                AS total_input_tokens,
    SUM(output_tokens)                               AS total_output_tokens,
    SUM(cost_usd)                                    AS total_cost_usd,
    AVG(duration_ms)                                 AS avg_duration_ms
  FROM observability.traces
  WHERE cost_usd IS NOT NULL
  GROUP BY 1, 2, 3, 4
  ORDER BY 1 DESC, 2, 3;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_rollup_daily
  ON observability.cost_rollup_daily (day, provider, model, domain);

-- ─── Alerts table (persisted alert events) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS observability.alerts (
  id          BIGSERIAL PRIMARY KEY,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  type        TEXT NOT NULL CHECK(type IN ('error_rate', 'latency_p95')),
  severity    TEXT NOT NULL DEFAULT 'warning' CHECK(severity IN ('info', 'warning', 'critical')),
  message     TEXT NOT NULL,
  threshold   INT NOT NULL,
  actual      INT NOT NULL,
  window_minutes INT NOT NULL,
  resolved    BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_alerts_unresolved ON observability.alerts (resolved, triggered_at DESC) WHERE NOT resolved;
CREATE INDEX IF NOT EXISTS idx_alerts_triggered ON observability.alerts (triggered_at DESC);
