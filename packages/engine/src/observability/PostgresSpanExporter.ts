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
  if (attrs['gen_ai.system']) return 'llm';
  if (attrs['tool.name']) return 'tool';
  if (attrs['openinference.span.kind'] === 'tool' && attrs['decision']) return 'tool_decision';
  if (attrs['journey.stage.id']) return 'journey_stage';
  if (attrs['agent.id']) return 'agent';
  if (attrs['retrieval.documents']) return 'retrieval';
  return 'internal';
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
    for (const span of spans) {
      if (span.parentSpanContext?.spanId) continue;
      const attrs = span.attributes;
      const error = span.status.code === SpanStatusCode.ERROR;
      traceRows.push({
        trace_id: span.spanContext().traceId,
        root_span_id: span.spanContext().spanId,
        domain: (attrs['trace.domain'] as ObservabilityDomain) ?? 'AGENT',
        kind: (attrs['trace.kind'] as TraceKind) ?? 'turn',
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
        tool_call_count: typeof attrs['agent.tool_call_count'] === 'number' ? (attrs['agent.tool_call_count'] as number) : 0,
        cost_usd: typeof attrs['gen_ai.usage.total_cost'] === 'number' ? (attrs['gen_ai.usage.total_cost'] as number) : 0,
      });
    }

    // Insert trace rows BEFORE spans so the spans.trace_id FK is satisfied.
    await Promise.all(traceRows.map((t) => this.store.insertTrace(t)));
    await this.store.insertSpans(spanRows);

    // Span-derived metrics (§8.2): publish counters/histograms so the
    // Prometheus `/api/metrics` endpoint and the MetricsSampler both see
    // token/cost/tool-call/turn-duration updates. Only root spans (turns /
    // app operations) carry the rolled-up totals, so we emit from traceRows.
    // Failures here never break the export — the sink is best-effort.
    try {
      for (const t of traceRows) {
        const domain = t.domain;
        if (t.input_tokens && t.input_tokens > 0) {
          spanMetricsSink.incrementCounter('agentx_llm_tokens_input_total', { domain }, t.input_tokens);
        }
        if (t.output_tokens && t.output_tokens > 0) {
          spanMetricsSink.incrementCounter('agentx_llm_tokens_output_total', { domain }, t.output_tokens);
        }
        if (t.cost_usd && t.cost_usd > 0) {
          spanMetricsSink.incrementCounter('agentx_llm_cost_usd_total', { domain }, t.cost_usd);
        }
        if (t.tool_call_count && t.tool_call_count > 0) {
          spanMetricsSink.incrementCounter('agentx_tool_calls_total', { domain }, t.tool_call_count);
        }
        if (t.kind === 'turn') {
          spanMetricsSink.incrementCounter('agentx_turns_total', { domain, status: t.status }, 1);
          if (typeof t.duration_ms === 'number' && t.duration_ms >= 0) {
            spanMetricsSink.recordHistogram('agentx_turn_duration_seconds', { domain }, t.duration_ms / 1000);
          }
        }
      }
      // Per-tool counters from tool spans (tool.name + tool.success).
      for (const span of spans) {
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
