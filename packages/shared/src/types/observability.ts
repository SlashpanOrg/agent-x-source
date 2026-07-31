import type { MetricSample, ObservabilityDomain } from './telemetry.js';

export type { MetricSample, ObservabilityDomain };

export type TraceKind =
  | 'turn'
  | 'autonomous_run'
  | 'crew_mission'
  | 'task_executor'
  | 'http_request'
  | 'ws_connection'
  | 'auth'
  | 'db_query'
  | 'channel_event'
  | 'automation_run'
  | 'startup'
  | 'integration_call'
  | 'job'
  | 'internal';

export type SpanKind =
  | 'llm'
  | 'tool'
  | 'tool_decision'
  | 'journey_stage'
  | 'agent'
  | 'retrieval'
  | 'internal'
  | 'http'
  | 'ws'
  | 'auth'
  | 'db'
  | 'channel'
  | 'automation'
  | 'integration'
  | 'job';

export interface TraceSummary {
  trace_id: string;
  domain: ObservabilityDomain;
  kind: TraceKind;
  session_id?: string;
  turn_id?: string;
  status: 'running' | 'ok' | 'error' | 'cancelled';
  started_at: string;
  ended_at?: string;
  duration_ms?: number;
  provider?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  tool_call_count: number;
  cost_usd: number;
  user_text?: string;
  user_text_preview?: string;
  error?: string;
}

export interface SpanNode {
  span_id: string;
  trace_id: string;
  parent_span_id?: string;
  domain: ObservabilityDomain;
  name: string;
  kind: SpanKind;
  status: 'ok' | 'error' | 'unset';
  started_at: string;
  ended_at?: string;
  duration_ms?: number;
  attributes: Record<string, unknown>;
  events: Array<{ name: string; timestamp: string; attributes?: Record<string, unknown> }>;
  children: SpanNode[];
}

export interface ObservabilityLogEntry {
  id: number;
  trace_id?: string;
  span_id?: string;
  session_id?: string;
  domain: ObservabilityDomain;
  ts: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  scope?: string;
  message: string;
  payload?: Record<string, unknown>;
}

export interface MetricPoint {
  ts: string;
  value: number;
}

export interface MetricSeries {
  name: string;
  labels: Record<string, string>;
  points: MetricPoint[];
}

export interface ObservabilityConfig {
  retention_days: number;
  capture_prompts: boolean;
  enabled: boolean;
  // OTLP external collector (v1.1+) — when enabled, spans are also exported
  // to an external OTLP receiver (SigNoz, Langfuse, Jaeger, etc.) in addition
  // to the local Postgres store.
  otlp_enabled?: boolean;
  otlp_endpoint?: string;
  otlp_protocol?: 'http' | 'grpc';
  otlp_headers?: Record<string, string>;
  // Alerting (v1.1+) — error-rate and latency-p95 SLO breach detection.
  alerting_enabled?: boolean;
  alerting_error_rate_pct?: number;
  alerting_latency_p95_ms?: number;
  alerting_window_minutes?: number;
}

/** Cost analytics rollup row (v1.1+) — per-day, per-provider, per-model. */
export interface CostRollupRow {
  day: string;
  provider: string;
  model: string;
  domain: string;
  trace_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  avg_duration_ms: number;
}

/** Alert event row (v1.1+). */
export interface AlertRow {
  id: number;
  triggered_at: string;
  type: 'error_rate' | 'latency_p95';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  threshold: number;
  actual: number;
  window_minutes: number;
  resolved: boolean;
  resolved_at?: string;
}

export interface TraceDetail extends TraceSummary {
  root_span_id: string;
  spans: SpanNode[];
  logs: ObservabilityLogEntry[];
  metrics: MetricSample[];
}

export interface DevVerifyRequest {
  password: string;
}

export interface DevVerifyResponse {
  success: boolean;
  error?: string;
}

/**
 * Auto-generated issue summary for a trace export bundle (§9.7.1).
 * Points an AI agent (or human) at the most likely root cause and
 * suggests concrete investigation steps.
 */
export interface TraceDiagnosis {
  status: 'ok' | 'error' | 'cancelled' | 'running';
  /** Spans with status='error'. */
  failing_spans: SpanNode[];
  /** The deepest failing span (closest to the actual failure); tiebreak by earliest started_at. */
  root_cause_span?: SpanNode;
  /** Distinct error strings from failing spans' attributes + error events + error-level logs. */
  error_messages: string[];
  /** Ordered human-readable summary of the span tree path from root to root_cause_span. */
  chain_of_events: string[];
  /** Token usage totals (input/output/total) from the trace row, if any. */
  token_usage?: { input: number; output: number; total: number };
  /** Summary of every tool call in the trace. */
  tool_calls: { name: string; success: boolean; elapsed_ms: number }[];
  /** Heuristic investigation suggestions (e.g. "Tool X failed; inspect tool.args and tool.output"). */
  suggested_investigation: string[];
}

/**
 * Self-contained, AI-agent-readable trace bundle (§9.7.1).
 * Serialized to JSON (machine-readable) or Markdown (human + AI readable).
 */
export interface TraceExportBundle {
  schema_version: 1;
  /** ISO timestamp of export. */
  exported_at: string;
  exporter: { name: 'agent-x'; version: string };
  trace: TraceSummary;
  /** Full span tree (root spans with nested children). */
  spans: SpanNode[];
  logs: ObservabilityLogEntry[];
  /** Metric samples in the trace's time window. */
  metrics: MetricSample[];
  /** Auto-generated issue summary. */
  diagnosis: TraceDiagnosis;
  environment: {
    agentx_version: string;
    provider: string;
    model: string;
    /** Non-secret config snapshot. */
    config_redacted: Record<string, unknown>;
  };
}
