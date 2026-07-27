import type { Pool } from 'pg';
import { VERSION, getLogger } from '@agentx/shared';
import type {
  ObservabilityConfig,
  ObservabilityDomain,
  ObservabilityLogEntry,
  MetricPoint,
  MetricSample,
  MetricSeries,
  SpanKind,
  SpanNode,
  TraceDetail,
  TraceDiagnosis,
  TraceExportBundle,
  TraceKind,
  TraceSummary,
  CostRollupRow,
  AlertRow,
} from '@agentx/shared';
import { redactAttributes, redactText } from './redact.js';

const logger = getLogger();

function toISO(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

export interface TraceInsert {
  trace_id: string;
  root_span_id: string;
  domain: ObservabilityDomain;
  kind: TraceKind;
  session_id?: string;
  turn_id?: string;
  user_text?: string;
  status: 'running' | 'ok' | 'error' | 'cancelled';
  error?: string;
  started_at: string;
  ended_at?: string;
  duration_ms?: number;
  provider?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  tool_call_count: number;
  cost_usd: number;
}

interface SpanInsert {
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
  attributes?: Record<string, unknown>;
  events?: Array<{ name: string; timestamp: string; attributes?: Record<string, unknown> }>;
}

interface LogInsert {
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

interface MetricInsert {
  ts: string;
  name: string;
  value: number;
  labels?: Record<string, string>;
}

export interface ListTracesFilters {
  domain?: ObservabilityDomain;
  session_id?: string;
  status?: TraceSummary['status'] | TraceSummary['status'][];
  kind?: TraceKind | TraceKind[];
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
  cursor?: string;
}

export interface ListLogsFilters {
  domain?: ObservabilityDomain;
  trace_id?: string;
  session_id?: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  scope?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export class ObservabilityStore {
  /** Cached capture_prompts value — updated on getConfig/updateConfig; defaults to true. */
  private cachedCapturePrompts = true;

  constructor(private pool: Pool) {}

  async insertTrace(row: TraceInsert): Promise<void> {
    const sql = `
      INSERT INTO observability.traces (
        trace_id, root_span_id, domain, kind, session_id, turn_id, user_text,
        status, error, started_at, ended_at, duration_ms, provider, model,
        input_tokens, output_tokens, tool_call_count, cost_usd
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (trace_id) DO UPDATE SET
        root_span_id = EXCLUDED.root_span_id,
        domain = EXCLUDED.domain,
        kind = EXCLUDED.kind,
        session_id = EXCLUDED.session_id,
        turn_id = EXCLUDED.turn_id,
        user_text = EXCLUDED.user_text,
        status = EXCLUDED.status,
        error = EXCLUDED.error,
        started_at = EXCLUDED.started_at,
        ended_at = EXCLUDED.ended_at,
        duration_ms = EXCLUDED.duration_ms,
        provider = EXCLUDED.provider,
        model = EXCLUDED.model,
        input_tokens = EXCLUDED.input_tokens,
        output_tokens = EXCLUDED.output_tokens,
        tool_call_count = EXCLUDED.tool_call_count,
        cost_usd = EXCLUDED.cost_usd
    `;
    try {
      await this.pool.query(sql, [
        row.trace_id,
        row.root_span_id,
        row.domain,
        row.kind,
        row.session_id ?? null,
        row.turn_id ?? null,
        redactText(row.user_text, this.cachedCapturePrompts) ?? null,
        row.status,
        row.error ?? null,
        row.started_at,
        row.ended_at ?? null,
        row.duration_ms ?? null,
        row.provider ?? null,
        row.model ?? null,
        row.input_tokens ?? null,
        row.output_tokens ?? null,
        row.tool_call_count ?? 0,
        row.cost_usd ?? 0,
      ]);
    } catch (err) {
      logger.error('OBSERVABILITY_STORE', err instanceof Error ? err : new Error('insertTrace failed'), { method: 'insertTrace' });
    }
  }

  async insertSpans(rows: SpanInsert[]): Promise<void> {
    if (rows.length === 0) return;
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let idx = 1;
    for (const row of rows) {
      placeholders.push(`($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`);
      values.push(
        row.span_id,
        row.trace_id,
        row.parent_span_id ?? null,
        row.domain,
        row.name,
        row.kind,
        row.status,
        row.started_at,
        row.ended_at ?? null,
        row.duration_ms ?? null,
        JSON.stringify(row.attributes ?? {}),
        JSON.stringify(row.events ?? []),
      );
    }
    const sql = `
      INSERT INTO observability.spans (
        span_id, trace_id, parent_span_id, domain, name, kind, status,
        started_at, ended_at, duration_ms, attributes, events
      ) VALUES ${placeholders.join(',')}
      ON CONFLICT (span_id) DO NOTHING
    `;
    try {
      await this.pool.query(sql, values);
    } catch (err) {
      logger.error('OBSERVABILITY_STORE', err instanceof Error ? err : new Error('insertSpans failed'), { method: 'insertSpans' });
    }
  }

  async insertLog(row: LogInsert): Promise<void> {
    await this.insertLogs([row]);
  }

  async insertLogs(rows: LogInsert[]): Promise<void> {
    if (rows.length === 0) return;
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let idx = 1;
    for (const row of rows) {
      placeholders.push(`($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`);
      values.push(
        row.trace_id ?? null,
        row.span_id ?? null,
        row.session_id ?? null,
        row.domain,
        row.ts,
        row.level,
        row.scope ?? null,
        row.message,
        JSON.stringify(row.payload ?? null),
      );
    }
    const sql = `INSERT INTO observability.logs (trace_id, span_id, session_id, domain, ts, level, scope, message, payload) VALUES ${placeholders.join(',')}`;
    try {
      await this.pool.query(sql, values);
    } catch (err) {
      logger.error('OBSERVABILITY_STORE', err instanceof Error ? err : new Error('insertLogs failed'), { method: 'insertLogs' });
    }
  }

  async insertMetricSamples(rows: MetricInsert[]): Promise<void> {
    if (rows.length === 0) return;
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let idx = 1;
    for (const row of rows) {
      placeholders.push(`($${idx++},$${idx++},$${idx++},$${idx++})`);
      values.push(row.ts, row.name, row.value, JSON.stringify(row.labels ?? {}));
    }
    const sql = `INSERT INTO observability.metric_samples (ts, name, value, labels) VALUES ${placeholders.join(',')}`;
    try {
      await this.pool.query(sql, values);
    } catch (err) {
      logger.error('OBSERVABILITY_STORE', err instanceof Error ? err : new Error('insertMetricSamples failed'), { method: 'insertMetricSamples' });
    }
  }

  private rowToTraceSummary(row: Record<string, unknown>): TraceSummary {
    const userText = row.user_text ? String(row.user_text) : undefined;
    return {
      trace_id: String(row.trace_id),
      domain: String(row.domain) as ObservabilityDomain,
      kind: String(row.kind) as TraceKind,
      session_id: row.session_id ? String(row.session_id) : undefined,
      turn_id: row.turn_id ? String(row.turn_id) : undefined,
      status: String(row.status) as TraceSummary['status'],
      started_at: toISO(row.started_at) ?? '',
      ended_at: toISO(row.ended_at),
      duration_ms: asNumber(row.duration_ms),
      provider: row.provider ? String(row.provider) : undefined,
      model: row.model ? String(row.model) : undefined,
      input_tokens: asNumber(row.input_tokens),
      output_tokens: asNumber(row.output_tokens),
      tool_call_count: asNumber(row.tool_call_count) ?? 0,
      cost_usd: asNumber(row.cost_usd) ?? 0,
      user_text: userText,
      user_text_preview: userText ? (userText.length > 120 ? `${userText.slice(0, 120)}...` : userText) : undefined,
      error: row.error ? String(row.error) : undefined,
    };
  }

  async getTrace(traceId: string): Promise<TraceDetail | undefined> {
    try {
      const { rows } = await this.pool.query<Record<string, unknown>>(
        'SELECT * FROM observability.traces WHERE trace_id = $1',
        [traceId],
      );
      if (rows.length === 0) return undefined;
      const trace = rows[0]!;
      const [spans, logs, metrics] = await Promise.all([
        this.getSpans(traceId),
        this.getLogs({ trace_id: traceId, limit: 1000 }),
        this.getTraceMetrics(traceId),
      ]);
      return {
        ...this.rowToTraceSummary(trace),
        root_span_id: String(trace.root_span_id),
        spans,
        logs,
        metrics,
      };
    } catch (err) {
      logger.error('OBSERVABILITY_STORE', err instanceof Error ? err : new Error('getTrace failed'), { method: 'getTrace' });
      return undefined;
    }
  }

  private getTraceMetrics(traceId: string): Promise<MetricSample[]> {
    return this.getMetricSamplesForTrace(traceId).catch((err) => {
      logger.error('OBSERVABILITY_STORE', err instanceof Error ? err : new Error('getTraceMetrics failed'), { method: 'getTraceMetrics' });
      return [];
    });
  }

  private async getMetricSamplesForTrace(traceId: string): Promise<MetricSample[]> {
    // metric_samples are not tied to a trace by schema; store trace_id in labels when needed.
    const { rows } = await this.pool.query<Record<string, unknown>>(
      "SELECT * FROM observability.metric_samples WHERE labels->>'trace_id' = $1 ORDER BY ts DESC LIMIT 1000",
      [traceId],
    );
    return rows.map((r) => ({
      name: String(r.name),
      value: asNumber(r.value) ?? 0,
      labels: (r.labels as Record<string, string>) ?? {},
      timestamp: r.ts instanceof Date ? r.ts.getTime() : undefined,
    }));
  }

  async listTraces(filters: ListTracesFilters = {}): Promise<TraceSummary[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    if (filters.domain) { where.push(`domain = $${values.push(filters.domain) && values.length}`); }
    if (filters.session_id) { where.push(`session_id = $${values.push(filters.session_id) && values.length}`); }
    if (filters.status) {
      const arr = Array.isArray(filters.status) ? filters.status : [filters.status];
      const placeholders = arr.map((v) => `$${values.push(v) && values.length}`).join(',');
      where.push(`status IN (${placeholders})`);
    }
    if (filters.kind) {
      const arr = Array.isArray(filters.kind) ? filters.kind : [filters.kind];
      const placeholders = arr.map((v) => `$${values.push(v) && values.length}`).join(',');
      where.push(`kind IN (${placeholders})`);
    }
    if (filters.from) { where.push(`started_at >= $${values.push(filters.from) && values.length}`); }
    if (filters.to) { where.push(`started_at <= $${values.push(filters.to) && values.length}`); }
    if (filters.q) { where.push(`(COALESCE(user_text,'') ILIKE $${values.push(`%${filters.q}%`) && values.length} OR COALESCE(error,'') ILIKE $${values.length})`); }
    if (filters.cursor) { where.push(`started_at < $${values.push(filters.cursor) && values.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = filters.limit ?? 100;
    values.push(limit);
    const sql = `SELECT * FROM observability.traces ${whereSql} ORDER BY started_at DESC LIMIT $${values.length}`;
    try {
      const { rows } = await this.pool.query<Record<string, unknown>>(sql, values);
      return rows.map((r) => this.rowToTraceSummary(r));
    } catch (err) {
      logger.error('OBSERVABILITY_STORE', err instanceof Error ? err : new Error('listTraces failed'), { method: 'listTraces' });
      return [];
    }
  }

  async getSpans(traceId: string): Promise<SpanNode[]> {
    try {
      const { rows } = await this.pool.query<Record<string, unknown>>(
        'SELECT * FROM observability.spans WHERE trace_id = $1 ORDER BY started_at ASC',
        [traceId],
      );
      const nodes = new Map<string, SpanNode>();
      const roots: SpanNode[] = [];
      for (const r of rows) {
        const node: SpanNode = {
          span_id: String(r.span_id),
          trace_id: String(r.trace_id),
          parent_span_id: r.parent_span_id ? String(r.parent_span_id) : undefined,
          domain: String(r.domain) as ObservabilityDomain,
          name: String(r.name),
          kind: String(r.kind) as SpanKind,
          status: String(r.status) as SpanNode['status'],
          started_at: toISO(r.started_at) ?? '',
          ended_at: toISO(r.ended_at),
          duration_ms: asNumber(r.duration_ms),
          attributes: (r.attributes as Record<string, unknown>) ?? {},
          events: (r.events as Array<{ name: string; timestamp: string; attributes?: Record<string, unknown> }>) ?? [],
          children: [],
        };
        nodes.set(node.span_id, node);
      }
      for (const node of nodes.values()) {
        if (node.parent_span_id && nodes.has(node.parent_span_id)) {
          nodes.get(node.parent_span_id)!.children.push(node);
        } else {
          roots.push(node);
        }
      }
      return roots;
    } catch (err) {
      logger.error('OBSERVABILITY_STORE', err instanceof Error ? err : new Error('getSpans failed'), { method: 'getSpans' });
      return [];
    }
  }

  async getLogs(filters: ListLogsFilters = {}): Promise<ObservabilityLogEntry[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    if (filters.domain) { where.push(`domain = $${values.push(filters.domain) && values.length}`); }
    if (filters.trace_id) { where.push(`trace_id = $${values.push(filters.trace_id) && values.length}`); }
    if (filters.session_id) { where.push(`session_id = $${values.push(filters.session_id) && values.length}`); }
    if (filters.level) { where.push(`level = $${values.push(filters.level) && values.length}`); }
    if (filters.scope) { where.push(`scope ILIKE $${values.push(`%${filters.scope}%`) && values.length}`); }
    if (filters.from) { where.push(`ts >= $${values.push(filters.from) && values.length}`); }
    if (filters.to) { where.push(`ts <= $${values.push(filters.to) && values.length}`); }
    if (filters.cursor) { where.push(`id < $${values.push(filters.cursor) && values.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = filters.limit ?? 100;
    values.push(limit);
    const sql = `SELECT * FROM observability.logs ${whereSql} ORDER BY ts DESC LIMIT $${values.length}`;
    try {
      const { rows } = await this.pool.query<Record<string, unknown>>(sql, values);
      return rows.map((r) => ({
        id: asNumber(r.id) ?? 0,
        trace_id: r.trace_id ? String(r.trace_id) : undefined,
        span_id: r.span_id ? String(r.span_id) : undefined,
        session_id: r.session_id ? String(r.session_id) : undefined,
        domain: String(r.domain) as ObservabilityDomain,
        ts: toISO(r.ts) ?? '',
        level: String(r.level) as ObservabilityLogEntry['level'],
        scope: r.scope ? String(r.scope) : undefined,
        message: String(r.message),
        payload: (r.payload as Record<string, unknown>) ?? undefined,
      }));
    } catch (err) {
      logger.error('OBSERVABILITY_STORE', err instanceof Error ? err : new Error('getLogs failed'), { method: 'getLogs' });
      return [];
    }
  }

  async getMetricSeries(
    name: string,
    labels: Record<string, string> = {},
    from?: string,
    to?: string,
    step: string = 'hour',
  ): Promise<MetricSeries | undefined> {
    const where: string[] = ['name = $1'];
    const values: unknown[] = [name];
    if (labels.domain) { where.push(`labels->>'domain' = $${values.push(labels.domain) && values.length}`); }
    if (from) { where.push(`ts >= $${values.push(from) && values.length}`); }
    if (to) { where.push(`ts <= $${values.push(to) && values.length}`); }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const sql = `
      SELECT date_trunc($${values.push(step) && values.length}, ts) AS bucket, AVG(value) AS value
      FROM observability.metric_samples
      ${whereSql}
      GROUP BY bucket
      ORDER BY bucket ASC
    `;
    try {
      const { rows } = await this.pool.query<Record<string, unknown>>(sql, values);
      const points: MetricPoint[] = rows.map((r) => ({
        ts: toISO(r.bucket) ?? '',
        value: asNumber(r.value) ?? 0,
      }));
      return { name, labels, points };
    } catch (err) {
      logger.error('OBSERVABILITY_STORE', err instanceof Error ? err : new Error('getMetricSeries failed'), { method: 'getMetricSeries' });
      return undefined;
    }
  }

  async listMetricNames(domain?: ObservabilityDomain): Promise<string[]> {
    const sql = domain
      ? "SELECT DISTINCT name FROM observability.metric_samples WHERE labels->>'domain' = $1 ORDER BY name"
      : 'SELECT DISTINCT name FROM observability.metric_samples ORDER BY name';
    try {
      const { rows } = await this.pool.query<{ name: string }>(sql, domain ? [domain] : []);
      return rows.map((r) => r.name);
    } catch (err) {
      logger.error('OBSERVABILITY_STORE', err instanceof Error ? err : new Error('listMetricNames failed'), { method: 'listMetricNames' });
      return [];
    }
  }

  async getConfig(): Promise<ObservabilityConfig | undefined> {
    try {
      const { rows } = await this.pool.query<Record<string, unknown>>(
        'SELECT * FROM observability.config WHERE id = 1',
      );
      if (rows.length === 0) return undefined;
      const r = rows[0]!;
      const cfg = this.mapConfigRow(r);
      this.cachedCapturePrompts = cfg.capture_prompts;
      return cfg;
    } catch (err) {
      logger.error('OBSERVABILITY_STORE', err instanceof Error ? err : new Error('getConfig failed'), { method: 'getConfig' });
      return undefined;
    }
  }

  async updateConfig(patch: Partial<ObservabilityConfig>): Promise<ObservabilityConfig | undefined> {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return this.getConfig();
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [k, v] of entries) {
      sets.push(`${k} = $${values.push(v) && values.length}`);
    }
    const sql = `UPDATE observability.config SET ${sets.join(', ')} WHERE id = 1 RETURNING *`;
    try {
      const { rows } = await this.pool.query<Record<string, unknown>>(sql, values);
      if (rows.length === 0) return undefined;
      const r = rows[0]!;
      const cfg = this.mapConfigRow(r);
      this.cachedCapturePrompts = cfg.capture_prompts;
      return cfg;
    } catch (err) {
      logger.error('OBSERVABILITY_STORE', err instanceof Error ? err : new Error('updateConfig failed'), { method: 'updateConfig' });
      return undefined;
    }
  }

  private mapConfigRow(r: Record<string, unknown>): ObservabilityConfig {
    return {
      retention_days: asNumber(r.retention_days) ?? 30,
      capture_prompts: Boolean(r.capture_prompts),
      enabled: Boolean(r.enabled),
      otlp_enabled: r.otlp_enabled != null ? Boolean(r.otlp_enabled) : false,
      otlp_endpoint: (r.otlp_endpoint as string) ?? 'http://localhost:4318/v1/traces',
      otlp_protocol: (r.otlp_protocol as 'http' | 'grpc') ?? 'http',
      otlp_headers: (r.otlp_headers as Record<string, string>) ?? {},
      alerting_enabled: r.alerting_enabled != null ? Boolean(r.alerting_enabled) : false,
      alerting_error_rate_pct: asNumber(r.alerting_error_rate_pct) ?? 10,
      alerting_latency_p95_ms: asNumber(r.alerting_latency_p95_ms) ?? 30000,
      alerting_window_minutes: asNumber(r.alerting_window_minutes) ?? 15,
    };
  }

  async purgeOlderThan(days: number): Promise<void> {
    try {
      await this.pool.query('BEGIN');
      // Logs: cascade-delete via trace_id (FK or manual).
      const logsResult = await this.pool.query(
        'DELETE FROM observability.logs WHERE trace_id IN (SELECT trace_id FROM observability.traces WHERE ended_at < NOW() - make_interval(days => $1)) RETURNING 1',
        [days],
      );
      // Traces: cascade cleans spans (FK ON DELETE CASCADE).
      const tracesResult = await this.pool.query(
        'DELETE FROM observability.traces WHERE ended_at < NOW() - make_interval(days => $1) RETURNING 1',
        [days],
      );
      // Metric samples: time-based purge (not trace-scoped).
      const metricsResult = await this.pool.query(
        'DELETE FROM observability.metric_samples WHERE ts < NOW() - make_interval(days => $1) RETURNING 1',
        [days],
      );
      await this.pool.query('COMMIT');
      logger.info('OBS_PURGE', 'Retention purge completed', {
        tracesDeleted: tracesResult.rowCount ?? 0,
        logsDeleted: logsResult.rowCount ?? 0,
        metricSamplesDeleted: metricsResult.rowCount ?? 0,
        retentionDays: days,
      });
    } catch (err) {
      await this.pool.query('ROLLBACK').catch(() => {});
      logger.error('OBSERVABILITY_STORE', err instanceof Error ? err : new Error('purgeOlderThan failed'), { method: 'purgeOlderThan' });
    }
  }

  async purgeAll(): Promise<void> {
    try {
      await this.pool.query('TRUNCATE observability.metric_samples, observability.logs, observability.spans, observability.traces RESTART IDENTITY CASCADE');
      logger.info('OBS_PURGE_ALL', 'All observability data purged');
    } catch (err) {
      logger.error('OBSERVABILITY_STORE', err instanceof Error ? err : new Error('purgeAll failed'), { method: 'purgeAll' });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Trace export bundle (§9.7.2)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Assemble a self-contained, AI-agent-readable trace bundle for export.
   * Includes the trace summary, full span tree, logs, metric samples in the
   * trace window, an auto-generated diagnosis, and a redacted environment
   * snapshot. Prompt/response/tool-args attributes are redacted when
   * `capture_prompts=false` in the observability config.
   */
  async getTraceExportBundle(traceId: string): Promise<TraceExportBundle | undefined> {
    try {
      const trace = await this.getTrace(traceId);
      if (!trace) return undefined;

      const config = await this.getConfig();
      const capturePrompts = config?.capture_prompts ?? true;

      // Redact span attributes + events in-place when capture_prompts=false.
      const spans = capturePrompts ? trace.spans : this.redactSpanTree(trace.spans, capturePrompts);

      // Logs: redact payload message fields that may contain prompts.
      const logs = capturePrompts ? trace.logs : trace.logs.map((l) => ({
        ...l,
        message: this.redactLogMessage(l.message, capturePrompts),
        payload: l.payload ? redactAttributes(l.payload, capturePrompts) : undefined,
      }));

      const diagnosis = this.buildDiagnosis(trace, spans, logs);

      return {
        schema_version: 1,
        exported_at: new Date().toISOString(),
        exporter: { name: 'agent-x', version: VERSION },
        trace: this.stripDetailFields(trace),
        spans,
        logs,
        metrics: trace.metrics,
        diagnosis,
        environment: {
          agentx_version: VERSION,
          provider: trace.provider ?? 'unknown',
          model: trace.model ?? 'unknown',
          config_redacted: this.redactedConfigSnapshot(config),
        },
      };
    } catch (err) {
      logger.error('OBSERVABILITY_STORE', err instanceof Error ? err : new Error('getTraceExportBundle failed'), { method: 'getTraceExportBundle' });
      return undefined;
    }
  }

  /** Strip TraceDetail-only fields to produce a plain TraceSummary for the bundle. */
  private stripDetailFields(trace: TraceDetail): TraceSummary {
    const { spans: _spans, logs: _logs, metrics: _metrics, root_span_id: _root, ...summary } = trace;
    void _spans; void _logs; void _metrics; void _root;
    return summary;
  }

  /** Recursively redact span attributes + events. */
  private redactSpanTree(spans: SpanNode[], capturePrompts: boolean): SpanNode[] {
    return spans.map((s) => ({
      ...s,
      attributes: redactAttributes(s.attributes, capturePrompts),
      events: s.events.map((e) => ({
        ...e,
        attributes: e.attributes ? redactAttributes(e.attributes, capturePrompts) : undefined,
      })),
      children: this.redactSpanTree(s.children, capturePrompts),
    }));
  }

  /** Best-effort redaction of log messages that may contain prompt content. */
  private redactLogMessage(message: string, capturePrompts: boolean): string {
    if (capturePrompts) return message;
    // Only redact messages that look like they carry prompt/response payloads;
    // keep short status messages intact for diagnosis readability.
    if (message.length > 200) return `[redacted:${message.length}]`;
    return message;
  }

  /** Non-secret config snapshot for the environment section. */
  private redactedConfigSnapshot(config: ObservabilityConfig | undefined): Record<string, unknown> {
    if (!config) return {};
    return {
      retention_days: config.retention_days,
      capture_prompts: config.capture_prompts,
      enabled: config.enabled,
    };
  }

  /**
   * Build the auto-generated diagnosis: failing spans, root cause (deepest
   * failing span), error messages, chain of events, token usage, tool calls,
   * and heuristic investigation suggestions.
   */
  private buildDiagnosis(
    trace: TraceDetail,
    spans: SpanNode[],
    logs: ObservabilityLogEntry[],
  ): TraceDiagnosis {
    const flatSpans = this.flattenSpans(spans);
    const failingSpans = flatSpans.filter((s) => s.status === 'error');

    // Root cause = deepest failing span (max tree depth); tiebreak by earliest started_at.
    let rootCauseSpan: SpanNode | undefined;
    if (failingSpans.length > 0) {
      const depths = new Map<string, number>();
      this.computeDepths(spans, 0, depths);
      const sorted = [...failingSpans].sort((a, b) => {
        const depthDiff = (depths.get(b.span_id) ?? 0) - (depths.get(a.span_id) ?? 0);
        if (depthDiff !== 0) return depthDiff;
        return a.started_at.localeCompare(b.started_at);
      });
      rootCauseSpan = sorted[0];
    }

    // Error messages: distinct error strings from failing spans + error events + error logs.
    const errorMessages = new Set<string>();
    for (const s of failingSpans) {
      const attrs = s.attributes;
      const errMsg = attrs['error'] ?? attrs['exception.message'] ?? attrs['otel.status_description'];
      if (typeof errMsg === 'string' && errMsg) errorMessages.add(errMsg);
      for (const ev of s.events) {
        if (ev.name === 'exception' || ev.name === 'error') {
          const evMsg = ev.attributes?.['exception.message'] ?? ev.attributes?.['message'];
          if (typeof evMsg === 'string' && evMsg) errorMessages.add(evMsg);
        }
      }
    }
    for (const l of logs) {
      if (l.level === 'error') errorMessages.add(l.message);
    }

    // Chain of events: walk from root span to root_cause_span.
    const chainOfEvents: string[] = [];
    if (rootCauseSpan) {
      const path = this.pathToSpan(spans, rootCauseSpan.span_id);
      for (const s of path) {
        const dur = s.duration_ms != null ? ` (${s.duration_ms}ms)` : '';
        const statusIcon = s.status === 'error' ? '🔴' : s.status === 'ok' ? '🟢' : '⚪';
        chainOfEvents.push(`${statusIcon} [${s.kind}] ${s.name}${dur} ${s.status}`);
      }
    }

    // Token usage from the trace row.
    const inputTokens = trace.input_tokens ?? 0;
    const outputTokens = trace.output_tokens ?? 0;
    const tokenUsage = (inputTokens || outputTokens)
      ? { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens }
      : undefined;

    // Tool calls from all tool spans.
    const toolCalls = flatSpans
      .filter((s) => s.kind === 'tool')
      .map((s) => ({
        name: (s.attributes['tool.name'] as string) ?? s.name,
        success: s.attributes['tool.success'] !== false && s.status !== 'error',
        elapsed_ms: typeof s.attributes['tool.elapsed_ms'] === 'number'
          ? (s.attributes['tool.elapsed_ms'] as number)
          : (s.duration_ms ?? 0),
      }));

    // Heuristic investigation suggestions.
    const suggestedInvestigation = this.buildSuggestions(flatSpans, trace);

    return {
      status: trace.status,
      failing_spans: failingSpans,
      root_cause_span: rootCauseSpan,
      error_messages: Array.from(errorMessages),
      chain_of_events: chainOfEvents,
      token_usage: tokenUsage,
      tool_calls: toolCalls,
      suggested_investigation: suggestedInvestigation,
    };
  }

  /** Flatten the span tree into a flat list (depth-first). */
  private flattenSpans(spans: SpanNode[]): SpanNode[] {
    const out: SpanNode[] = [];
    const walk = (nodes: SpanNode[]): void => {
      for (const n of nodes) {
        out.push(n);
        walk(n.children);
      }
    };
    walk(spans);
    return out;
  }

  /** Compute the tree depth of each span and populate the depths map. */
  private computeDepths(spans: SpanNode[], depth: number, depths: Map<string, number>): void {
    for (const s of spans) {
      depths.set(s.span_id, depth);
      this.computeDepths(s.children, depth + 1, depths);
    }
  }

  /** Find the path from a root span to the target span (inclusive). Returns [] if not found. */
  private pathToSpan(spans: SpanNode[], targetSpanId: string): SpanNode[] {
    const walk = (nodes: SpanNode[], acc: SpanNode[]): SpanNode[] | null => {
      for (const n of nodes) {
        const next = [...acc, n];
        if (n.span_id === targetSpanId) return next;
        const found = walk(n.children, next);
        if (found) return found;
      }
      return null;
    };
    return walk(spans, []) ?? [];
  }

  /**
   * Heuristic investigation suggestions (§9.7.2). Points the reader at the
   * most likely cause and tells them exactly which attributes to inspect.
   */
  private buildSuggestions(flatSpans: SpanNode[], trace: TraceDetail): string[] {
    const suggestions: string[] = [];
    const toolSpans = flatSpans.filter((s) => s.kind === 'tool');
    const llmSpans = flatSpans.filter((s) => s.kind === 'llm');
    const toolDecisionSpans = flatSpans.filter((s) => s.kind === 'tool_decision');

    // Failed tool span.
    for (const s of toolSpans) {
      if (s.status === 'error') {
        const name = (s.attributes['tool.name'] as string) ?? s.name;
        const err = (s.attributes['error'] as string) ?? 'unknown error';
        suggestions.push(`Tool '${name}' failed with: ${err}. Inspect tool.args and tool.output in the spans above.`);
      }
    }

    // Failed LLM span.
    for (const s of llmSpans) {
      if (s.status === 'error') {
        const provider = (s.attributes['gen_ai.system'] as string) ?? 'unknown';
        const model = (s.attributes['gen_ai.request.model'] as string) ?? 'unknown';
        const err = (s.attributes['error'] as string) ?? 'unknown error';
        suggestions.push(`LLM call to ${provider}/${model} failed: ${err}. Check llm.input_messages for a malformed prompt or provider outage.`);
      }
    }

    // Truncated response (finish_reason=length).
    for (const s of llmSpans) {
      const finishReason = s.attributes['gen_ai.response.finish_reason'];
      if (finishReason === 'length') {
        suggestions.push('LLM response was truncated (finish_reason=length). Consider increasing max_tokens or splitting the turn.');
      }
    }

    // Tool decision without a matching tool execution.
    for (const td of toolDecisionSpans) {
      const decidedName = (td.attributes['tool.name'] as string) ?? td.name.replace(/^tool_decision\./, '');
      const hasMatchingTool = toolSpans.some((t) => {
        const tName = (t.attributes['tool.name'] as string) ?? t.name;
        return tName === decidedName;
      });
      if (!hasMatchingTool) {
        suggestions.push(`Model decided to call '${decidedName}' but execution did not occur — possible guard rejection or dispatch bug.`);
      }
    }

    // Guard rejection (REPEAT_FETCH or similar).
    for (const s of flatSpans) {
      const guardReason = s.attributes['guard.reason'] ?? s.attributes['tool.rejected_reason'];
      if (typeof guardReason === 'string' && guardReason) {
        suggestions.push(`Tool call was rejected by a guard: ${guardReason}.`);
      }
    }

    // No LLM call but trace errored — failure before the model was invoked.
    if (llmSpans.length === 0 && trace.status === 'error') {
      suggestions.push('No LLM call recorded — failure happened before the model was invoked (journey/retrieval/turn setup).');
    }

    // If everything is OK, say so.
    if (suggestions.length === 0 && trace.status === 'ok') {
      suggestions.push('Trace completed successfully with no errors detected.');
    }

    return suggestions;
  }

  // ─── Cost analytics (v1.1+) ──────────────────────────────────────────────

  async getCostRollup(days = 30): Promise<CostRollupRow[]> {
    try {
      await this.pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY observability.cost_rollup_daily');
      const { rows } = await this.pool.query<CostRollupRow>(
        `SELECT * FROM observability.cost_rollup_daily
         WHERE day >= CURRENT_DATE - $1::int
         ORDER BY day DESC, total_cost_usd DESC NULLS LAST
         LIMIT 500`,
        [days],
      );
      return rows;
    } catch (err) {
      logger.error('OBSERVABILITY_STORE', err instanceof Error ? err : new Error('getCostRollup failed'), { method: 'getCostRollup' });
      return [];
    }
  }

  // ─── Alerting (v1.1+) ────────────────────────────────────────────────────

  async listAlerts(resolvedOnly = false, limit = 100): Promise<AlertRow[]> {
    try {
      const sql = resolvedOnly
        ? `SELECT * FROM observability.alerts WHERE resolved = true ORDER BY triggered_at DESC LIMIT $1`
        : `SELECT * FROM observability.alerts WHERE resolved = false ORDER BY triggered_at DESC LIMIT $1`;
      const { rows } = await this.pool.query<AlertRow>(sql, [limit]);
      return rows;
    } catch (err) {
      logger.error('OBSERVABILITY_STORE', err instanceof Error ? err : new Error('listAlerts failed'), { method: 'listAlerts' });
      return [];
    }
  }

  async insertAlert(alert: Omit<AlertRow, 'id' | 'triggered_at' | 'resolved' | 'resolved_at'>): Promise<AlertRow | undefined> {
    try {
      const { rows } = await this.pool.query<AlertRow>(
        `INSERT INTO observability.alerts (type, severity, message, threshold, actual, window_minutes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [alert.type, alert.severity, alert.message, alert.threshold, alert.actual, alert.window_minutes],
      );
      return rows[0];
    } catch (err) {
      logger.error('OBSERVABILITY_STORE', err instanceof Error ? err : new Error('insertAlert failed'), { method: 'insertAlert' });
      return undefined;
    }
  }

  async resolveAlert(id: number): Promise<void> {
    try {
      await this.pool.query(
        'UPDATE observability.alerts SET resolved = true, resolved_at = now() WHERE id = $1',
        [id],
      );
    } catch (err) {
      logger.error('OBSERVABILITY_STORE', err instanceof Error ? err : new Error('resolveAlert failed'), { method: 'resolveAlert' });
    }
  }

  /**
   * Evaluate alerting rules against recent traces and insert alerts for
   * any SLO breaches. Called periodically by the AlertingChecker.
   */
  async evaluateAlerts(): Promise<AlertRow[]> {
    const cfg = await this.getConfig();
    if (!cfg?.alerting_enabled) return [];
    const windowMin = cfg.alerting_window_minutes ?? 15;
    const errorThreshold = cfg.alerting_error_rate_pct ?? 10;
    const latencyThreshold = cfg.alerting_latency_p95_ms ?? 30000;
    const newAlerts: AlertRow[] = [];

    try {
      // Error-rate check: percentage of error traces in the window.
      const { rows: errRows } = await this.pool.query<Record<string, unknown>>(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE status = 'error') AS errors
         FROM observability.traces
         WHERE started_at >= now() - ($1::int || ' minutes')::interval`,
        [windowMin],
      );
      const total = asNumber(errRows[0]?.total) ?? 0;
      const errors = asNumber(errRows[0]?.errors) ?? 0;
      if (total >= 10) {
        const errorPct = Math.round((errors / total) * 100);
        if (errorPct > errorThreshold) {
          const alert = await this.insertAlert({
            type: 'error_rate',
            severity: errorPct > errorThreshold * 2 ? 'critical' : 'warning',
            message: `Error rate ${errorPct}% exceeds threshold ${errorThreshold}% (${errors}/${total} traces in ${windowMin}min)`,
            threshold: errorThreshold,
            actual: errorPct,
            window_minutes: windowMin,
          });
          if (alert) newAlerts.push(alert);
        }
      }

      // Latency p95 check.
      const { rows: latRows } = await this.pool.query<Record<string, unknown>>(
        `SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95
         FROM observability.traces
         WHERE started_at >= now() - ($1::int || ' minutes')::interval
           AND duration_ms IS NOT NULL`,
        [windowMin],
      );
      const p95 = asNumber(latRows[0]?.p95);
      if (p95 != null && p95 > latencyThreshold) {
        const alert = await this.insertAlert({
          type: 'latency_p95',
          severity: p95 > latencyThreshold * 2 ? 'critical' : 'warning',
          message: `p95 latency ${Math.round(p95)}ms exceeds threshold ${latencyThreshold}ms (last ${windowMin}min)`,
          threshold: latencyThreshold,
          actual: Math.round(p95),
          window_minutes: windowMin,
        });
        if (alert) newAlerts.push(alert);
      }
    } catch (err) {
      logger.error('OBSERVABILITY_STORE', err instanceof Error ? err : new Error('evaluateAlerts failed'), { method: 'evaluateAlerts' });
    }
    return newAlerts;
  }
}
