import { SpanStatusCode } from '@opentelemetry/api';
import { ExportResultCode } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { ObservabilityDomain, SpanKind, TraceKind } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { ObservabilityStore, type TraceInsert } from './ObservabilityStore.js';
import { redactAttributes } from './redact.js';

const logger = getLogger();

function hrToDate(hr: [number, number]): Date {
  const ms = hr[0] * 1e3 + hr[1] / 1e6;
  return new Date(ms);
}

function hrToMs(hr: [number, number]): number {
  return Math.round(hr[0] * 1e3 + hr[1] / 1e6);
}

function mapStatus(span: ReadableSpan): 'ok' | 'error' | 'unset' {
  if (span.status.code === SpanStatusCode.ERROR) return 'error';
  if (span.status.code === SpanStatusCode.OK) return 'ok';
  return 'unset';
}

function mapSpanKind(span: ReadableSpan): SpanKind {
  const attrs = span.attributes;
  const kindAttr = attrs['span.kind'];
  if (kindAttr === 'llm') return 'llm';
  if (kindAttr === 'tool') return 'tool';
  if (kindAttr === 'tool_decision') return 'tool_decision';
  if (kindAttr === 'agent') return 'agent';
  if (kindAttr === 'journey_stage') return 'journey_stage';
  if (kindAttr === 'retrieval') return 'retrieval';
  if (kindAttr === 'http') return 'http';
  if (kindAttr === 'ws') return 'ws';
  if (kindAttr === 'auth') return 'auth';
  if (kindAttr === 'db') return 'db';
  if (kindAttr === 'channel') return 'channel';
  if (kindAttr === 'automation' || kindAttr === 'automation_run') return 'automation';
  if (kindAttr === 'integration' || kindAttr === 'integration_call') return 'integration';
  if (kindAttr === 'job') return 'job';
  if (attrs['gen_ai.system']) return 'llm';
  if (attrs['tool.name']) return 'tool';
  if (attrs['openinference.span.kind'] === 'tool' && attrs['decision']) return 'tool_decision';
  if (attrs['journey.stage.id']) return 'journey_stage';
  if (attrs['agent.id']) return 'agent';
  if (attrs['retrieval.documents']) return 'retrieval';
  return 'internal';
}

function inferTraceKind(spanName: string, attrs: Record<string, unknown>): TraceKind {
  if (attrs['trace.kind']) return attrs['trace.kind'] as TraceKind;
  const n = spanName.toLowerCase();
  if (n.startsWith('http.')) return 'http_request';
  if (n.startsWith('ws.')) return 'ws_connection';
  if (n.startsWith('auth.')) return 'auth';
  if (n.startsWith('db.')) return 'db_query';
  if (n.startsWith('channel.')) return 'channel_event';
  if (n.startsWith('automation.')) return 'automation_run';
  if (n.startsWith('integration.')) return 'integration_call';
  if (n.startsWith('job.')) return 'job';
  if (n.startsWith('startup.')) return 'startup';
  if (n.startsWith('turn.') || n === 'turn') return 'turn';
  return 'internal';
}

/** Count tool executions in a trace batch — used when root HTTP spans lack agent.tool_call_count. */
function countToolCallsInTrace(
  spans: Array<{ spanContext(): { traceId: string }; name: string; attributes: Record<string, unknown> }>,
  traceId: string,
): number {
  let fromAttr = 0;
  let fromToolSpans = 0;
  for (const span of spans) {
    if (span.spanContext().traceId !== traceId) continue;
    const attrs = span.attributes ?? {};
    if (typeof attrs['agent.tool_call_count'] === 'number') {
      fromAttr = Math.max(fromAttr, attrs['agent.tool_call_count'] as number);
    }
    if (attrs['tool.name'] || span.name.startsWith('tool.')) {
      fromToolSpans += 1;
    }
  }
  return Math.max(fromAttr, fromToolSpans);
}

// Suppress noisy infrastructure traces from the trace list while still recording
// HTTP metrics and logging. Spans are dropped for these traces too.
const SKIP_TRACE_PREFIXES = ['/api/observability/', '/api/auth/', '/api/health'];
function shouldSkipTrace(attrs: Record<string, unknown>): boolean {
  const route = attrs['http.route'] ? String(attrs['http.route']) : undefined;
  if (!route) return false;
  return route === '/api/health' || SKIP_TRACE_PREFIXES.some((p) => route.startsWith(p));
}

export interface PostgresSpanExporterOptions {
  /** Ring-buffer capacity; when full the oldest spans are dropped. */
  ringBufferSize?: number;
  /** Returns the current capture_prompts config value. */
  getCapturePrompts?: () => boolean;
}

/**
 * A minimal metrics sink the web-api layer can wire up to its MetricsRegistry.
 * Used by the span exporter to publish span-derived counters/histograms
 * (tokens, cost, tool calls, turn duration) so the Prometheus `/api/metrics`
 * endpoint and the {@link MetricsSampler} both see them (§8.2).
 */
export interface SpanMetricsSink {
  incrementCounter(name: string, labels: Record<string, string>, value?: number): void;
  recordHistogram(name: string, labels: Record<string, string>, valueSeconds: number): void;
}

class NullSpanMetricsSink implements SpanMetricsSink {
  incrementCounter(): void { /* no-op until a sink is plugged in */ }
  recordHistogram(): void { /* no-op until a sink is plugged in */ }
}

let spanMetricsSink: SpanMetricsSink = new NullSpanMetricsSink();

/**
 * Plug an external metrics registry (e.g. the web-api `metricsRegistry`) into
 * the span exporter. Until this is called, span-derived metrics are silently
 * dropped — spans still flow through the tracer regardless.
 */
export function setSpanMetricsSink(sink: SpanMetricsSink): void {
  spanMetricsSink = sink;
}

export class PostgresSpanExporter implements SpanExporter {
  private readonly ringBuffer: ReadableSpan[] = [];
  private readonly ringBufferMax: number;
  private readonly getCapturePrompts: () => boolean;
  /** Number of spans dropped due to backpressure. Exposed via /health. */
  droppedCount = 0;
  private shutdownFlag = false;

  constructor(
    private store: ObservabilityStore,
    opts: PostgresSpanExporterOptions = {},
  ) {
    this.ringBufferMax = opts.ringBufferSize ?? 4096;
    this.getCapturePrompts = opts.getCapturePrompts ?? (() => true);
  }

  export(spans: ReadableSpan[], resultCallback: (result: { code: ExportResultCode }) => void): void {
    if (this.shutdownFlag) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }
    // Push into the ring buffer with backpressure.
    for (const span of spans) {
      if (this.ringBuffer.length >= this.ringBufferMax) {
        this.ringBuffer.shift();
        this.droppedCount += 1;
        logger.warn('OBS_SPAN_DROP', `Span ring buffer full (${this.ringBufferMax}); dropping oldest. Total dropped: ${this.droppedCount}`);
      }
      this.ringBuffer.push(span);
    }
    this.flushBuffer()
      .then(() => resultCallback({ code: ExportResultCode.SUCCESS }))
      .catch((err) => {
        logger.error('OBSERVABILITY_EXPORT', err instanceof Error ? err : new Error('span export failed'));
        resultCallback({ code: ExportResultCode.FAILED });
      });
  }

  async shutdown(): Promise<void> {
    this.shutdownFlag = true;
    await this.flushBuffer();
  }

  async forceFlush(): Promise<void> {
    await this.flushBuffer();
  }

  private async flushBuffer(): Promise<void> {
    if (this.ringBuffer.length === 0) return;
    const spans = this.ringBuffer.splice(0);
    await this.flush(spans);
  }

  private async flush(spans: ReadableSpan[]): Promise<void> {
    const capturePrompts = this.getCapturePrompts();
    const spanRows = spans.map((span) => ({
      span_id: span.spanContext().spanId,
      trace_id: span.spanContext().traceId,
      parent_span_id: span.parentSpanContext?.spanId,
      domain: (span.attributes['trace.domain'] as ObservabilityDomain) ?? 'AGENT',
      name: span.name,
      kind: mapSpanKind(span),
      status: mapStatus(span),
      started_at: hrToDate(span.startTime as [number, number]).toISOString(),
      ended_at: span.ended ? hrToDate(span.endTime as [number, number]).toISOString() : undefined,
      duration_ms: span.ended ? hrToMs(span.duration as [number, number]) : undefined,
      attributes: redactAttributes(span.attributes as Record<string, unknown>, capturePrompts),
      events: (span.events ?? []).map((e) => ({
        name: e.name,
        timestamp: hrToDate(e.time as [number, number]).toISOString(),
        attributes: redactAttributes((e.attributes as Record<string, unknown>) ?? {}, capturePrompts),
      })),
    }));

    const traceRows: TraceInsert[] = [];
    const skipTraceIds = new Set<string>();
    for (const span of spans) {
      if (span.parentSpanContext?.spanId) continue;
      const attrs = span.attributes;
      if (shouldSkipTrace(attrs)) {
        skipTraceIds.add(span.spanContext().traceId);
        continue;
      }
      const error = span.status.code === SpanStatusCode.ERROR;
      traceRows.push({
        trace_id: span.spanContext().traceId,
        root_span_id: span.spanContext().spanId,
        domain: (attrs['trace.domain'] as ObservabilityDomain) ?? 'AGENT',
        kind: inferTraceKind(span.name, attrs),
        session_id: attrs['session.id'] ? String(attrs['session.id']) : undefined,
        turn_id: attrs['turn.id'] ? String(attrs['turn.id']) : undefined,
        user_text: attrs['user.text'] ? String(attrs['user.text']) : undefined,
        status: error ? 'error' : span.ended ? 'ok' : 'running',
        error: error && span.status.message ? span.status.message : undefined,
        started_at: hrToDate(span.startTime as [number, number]).toISOString(),
        ended_at: span.ended ? hrToDate(span.endTime as [number, number]).toISOString() : undefined,
        duration_ms: span.ended ? hrToMs(span.duration as [number, number]) : undefined,
        provider: attrs['gen_ai.system'] ? String(attrs['gen_ai.system']) : undefined,
        model: attrs['gen_ai.response.model']
          ? String(attrs['gen_ai.response.model'])
          : attrs['gen_ai.request.model']
            ? String(attrs['gen_ai.request.model'])
            : undefined,
        input_tokens: typeof attrs['gen_ai.usage.input_tokens'] === 'number' ? (attrs['gen_ai.usage.input_tokens'] as number) : undefined,
        output_tokens: typeof attrs['gen_ai.usage.output_tokens'] === 'number' ? (attrs['gen_ai.usage.output_tokens'] as number) : undefined,
        tool_call_count: (() => {
          const attrCount = typeof attrs['agent.tool_call_count'] === 'number' ? (attrs['agent.tool_call_count'] as number) : 0;
          const derived = countToolCallsInTrace(spans, span.spanContext().traceId);
          return Math.max(attrCount, derived);
        })(),
        cost_usd: typeof attrs['gen_ai.usage.total_cost'] === 'number' ? (attrs['gen_ai.usage.total_cost'] as number) : 0,
      });
    }

    // Drop spans belonging to noisy infrastructure traces (health, observability UI, auth).
    const exportedSpanRows = spanRows.filter((s) => !skipTraceIds.has(s.trace_id));

    // Ensure every trace_id in the span batch has a corresponding trace row.
    // Root spans create real trace rows above, but child spans may arrive without
    // their root span (dropped from ring buffer due to backpressure, or root span
    // already exported in a previous batch whose insertTrace failed silently).
    // Without a trace row, the spans.trace_id FK constraint fails.
    const traceIdsWithRoot = new Set(traceRows.map((t) => t.trace_id));
    const stubTraceRows: TraceInsert[] = [];
    const seenStubIds = new Set<string>();
    for (const span of exportedSpanRows) {
      if (traceIdsWithRoot.has(span.trace_id) || seenStubIds.has(span.trace_id)) continue;
      seenStubIds.add(span.trace_id);
      // Find the earliest span for this trace to use as a reference for the stub.
      const traceSpans = spans.filter((s) => s.spanContext().traceId === span.trace_id);
      const earliest = traceSpans.sort((a, b) => {
        const aMs = hrToMs(a.startTime as [number, number]);
        const bMs = hrToMs(b.startTime as [number, number]);
        return aMs - bMs;
      })[0];
      const attrs = earliest?.attributes ?? {};
      const hasError = traceSpans.some((s) => s.status.code === SpanStatusCode.ERROR);
      stubTraceRows.push({
        trace_id: span.trace_id,
        root_span_id: span.span_id,
        domain: (attrs['trace.domain'] as ObservabilityDomain) ?? 'AGENT',
        kind: inferTraceKind(earliest?.name ?? 'internal', attrs),
        session_id: attrs['session.id'] ? String(attrs['session.id']) : undefined,
        turn_id: attrs['turn.id'] ? String(attrs['turn.id']) : undefined,
        user_text: attrs['user.text'] ? String(attrs['user.text']) : undefined,
        status: hasError ? 'error' : 'ok',
        error: undefined,
        started_at: span.started_at,
        ended_at: undefined,
        duration_ms: undefined,
        provider: attrs['gen_ai.system'] ? String(attrs['gen_ai.system']) : undefined,
        model: attrs['gen_ai.response.model']
          ? String(attrs['gen_ai.response.model'])
          : attrs['gen_ai.request.model']
            ? String(attrs['gen_ai.request.model'])
            : undefined,
        input_tokens: undefined,
        output_tokens: undefined,
        tool_call_count: countToolCallsInTrace(spans, span.trace_id),
        cost_usd: 0,
      });
    }

    // Insert trace rows BEFORE spans so the spans.trace_id FK is satisfied.
    // insertTrace returns false on failure (non-throwing); track which trace_ids
    // failed so we can skip their spans to avoid FK violations.
    const failedTraceIds = new Set<string>();
    for (const t of [...traceRows, ...stubTraceRows]) {
      const ok = await this.store.insertTrace(t);
      if (!ok) failedTraceIds.add(t.trace_id);
    }
    // Drop spans whose trace row insertion failed to avoid FK violations.
    const safeSpanRows = failedTraceIds.size > 0
      ? exportedSpanRows.filter((s) => !failedTraceIds.has(s.trace_id))
      : exportedSpanRows;
    if (safeSpanRows.length > 0) {
      await this.store.insertSpans(safeSpanRows);
    }

    // Span-derived metrics (§8.2): publish counters/histograms so the
    // Prometheus `/api/metrics` endpoint and the MetricsSampler both see
    // token/cost/tool-call/turn-duration updates. Only root spans (turns /
    // app operations) carry the rolled-up totals, so we emit from traceRows.
    // Failures here never break the export — the sink is best-effort.
    try {
      for (const t of traceRows) {
        const domain = t.domain;
        const totalTokens = (t.input_tokens ?? 0) + (t.output_tokens ?? 0);
        if (totalTokens > 0) {
          spanMetricsSink.incrementCounter('agentx_tokens_total', { domain }, totalTokens);
        }
        if (t.input_tokens && t.input_tokens > 0) {
          spanMetricsSink.incrementCounter('agentx_llm_tokens_input_total', { domain }, t.input_tokens);
        }
        if (t.output_tokens && t.output_tokens > 0) {
          spanMetricsSink.incrementCounter('agentx_llm_tokens_output_total', { domain }, t.output_tokens);
        }
        if (t.cost_usd && t.cost_usd > 0) {
          spanMetricsSink.incrementCounter('agentx_cost_usd_total', { domain }, t.cost_usd);
        }
        if (t.tool_call_count && t.tool_call_count > 0) {
          spanMetricsSink.incrementCounter('agentx_tool_calls_total', { domain }, t.tool_call_count);
        }
        if (t.kind === 'turn') {
          spanMetricsSink.incrementCounter('agentx_turns_total', { domain, status: t.status }, 1);
          if (t.status === 'error') {
            spanMetricsSink.incrementCounter('agentx_turn_errors_total', { domain }, 1);
          }
          if (typeof t.duration_ms === 'number' && t.duration_ms >= 0) {
            spanMetricsSink.recordHistogram('agentx_turn_duration_seconds', { domain }, t.duration_ms / 1000);
          }
        }
      }
      // Per-tool counters from tool spans (tool.name + tool.success).
      for (const span of spans) {
        if (skipTraceIds.has(span.spanContext().traceId)) continue;
        if (span.attributes['tool.name'] && span.ended) {
          const toolName = String(span.attributes['tool.name']);
          const success = span.status.code !== SpanStatusCode.ERROR;
          const domain = (span.attributes['trace.domain'] as ObservabilityDomain) ?? 'AGENT';
          spanMetricsSink.incrementCounter('agentx_tool_calls_total', { domain, tool: toolName, success: String(success) }, 1);
          const dur = hrToMs(span.duration as [number, number]);
          if (dur >= 0) {
            spanMetricsSink.recordHistogram('agentx_tool_latency_seconds', { domain, tool: toolName }, dur / 1000);
          }
        }
      }
    } catch {
      // A sink failure must never break the trace export.
    }
  }
}
