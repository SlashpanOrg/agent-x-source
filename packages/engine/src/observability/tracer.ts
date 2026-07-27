import { trace, context, SpanStatusCode, type Span, type Tracer } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { VERSION } from '@agentx/shared';
import type { ObservabilityConfig } from '@agentx/shared';
import { PostgresSpanExporter } from './PostgresSpanExporter.js';
import { ObservabilityStore } from './ObservabilityStore.js';

let sdk: NodeSDK | undefined;
let spanExporter: PostgresSpanExporter | undefined;
let tracerEnabled = false;

export interface TracerConfig {
  enabled: boolean;
  batchSize?: number;
  flushMs?: number;
  getCapturePrompts?: () => boolean;
  /** OTLP external collector config (v1.1+). When set, a second span processor exports to the remote endpoint. */
  otlp?: Pick<ObservabilityConfig, 'otlp_enabled' | 'otlp_endpoint' | 'otlp_protocol' | 'otlp_headers'>;
}

export function initTracer(store: ObservabilityStore, cfg: TracerConfig): void {
  if (sdk || spanExporter) return;
  spanExporter = new PostgresSpanExporter(store, {
    getCapturePrompts: cfg.getCapturePrompts,
  });
  tracerEnabled = cfg.enabled;
  if (!tracerEnabled) return;

  const batchSize = cfg.batchSize ?? 512;
  const flushMs = cfg.flushMs ?? 5000;

  const spanProcessors: BatchSpanProcessor[] = [
    new BatchSpanProcessor(spanExporter, {
      maxQueueSize: batchSize * 4,
      maxExportBatchSize: batchSize,
      scheduledDelayMillis: flushMs,
    }),
  ];

  // OTLP external collector (v1.1+) — add a second processor that exports
  // to a remote OTLP receiver (SigNoz, Langfuse, Jaeger, etc.).
  if (cfg.otlp?.otlp_enabled && cfg.otlp.otlp_endpoint) {
    try {
      const otlpProcessor = createOtlpProcessor(cfg.otlp, batchSize, flushMs);
      if (otlpProcessor) spanProcessors.push(otlpProcessor);
    } catch (err) {
      // Non-fatal — local observability still works.
      console.warn('[observability] OTLP processor init failed:', err);
    }
  }

  sdk = new NodeSDK({
    serviceName: 'agent-x',
    resource: resourceFromAttributes({
      'service.name': 'agent-x',
      'service.version': VERSION,
    }),
    spanProcessors,
  });
  sdk.start();
}

/**
 * Create an OTLP span processor based on the configured protocol.
 * Uses dynamic import so the OTLP exporter packages are only loaded when needed.
 */
function createOtlpProcessor(
  otlp: Pick<ObservabilityConfig, 'otlp_endpoint' | 'otlp_protocol' | 'otlp_headers'>,
  batchSize: number,
  flushMs: number,
): BatchSpanProcessor | undefined {
  const endpoint = otlp.otlp_endpoint!;
  const protocol = otlp.otlp_protocol ?? 'http';
  const headers = otlp.otlp_headers ?? {};

  // We use synchronous require because the OTLP packages are bundled by tsup.
  // Dynamic import() would also work but require is simpler for the engine context.
  const module = require('module');
  const require_ = module.createRequire(import.meta.url);

  let exporter: unknown;
  if (protocol === 'grpc') {
    const { OTLPTraceExporter } = require_('@opentelemetry/exporter-trace-otlp-grpc');
    exporter = new OTLPTraceExporter({ url: endpoint, headers });
  } else {
    const { OTLPTraceExporter } = require_('@opentelemetry/exporter-trace-otlp-http');
    exporter = new OTLPTraceExporter({ url: endpoint, headers });
  }

  return new BatchSpanProcessor(exporter as ConstructorParameters<typeof BatchSpanProcessor>[0], {
    maxQueueSize: batchSize * 4,
    maxExportBatchSize: batchSize,
    scheduledDelayMillis: flushMs,
  });
}

export function shutdownTracer(): Promise<void> {
  return sdk?.shutdown() ?? Promise.resolve();
}

export function isTracerEnabled(): boolean {
  return tracerEnabled;
}

/**
 * Return the active {@link PostgresSpanExporter}, or undefined if the tracer
 * has not been initialized. Used by the observability `/health` endpoint
 * (§9.2) to report queue depth + dropped count.
 */
export function getSpanExporter(): PostgresSpanExporter | undefined {
  return spanExporter;
}

export function getTracer(): Tracer {
  return trace.getTracer('agent-x');
}

export function getCurrentSpan(): Span | undefined {
  return trace.getSpan(context.active()) ?? undefined;
}

export function getCurrentTraceId(): string | undefined {
  return getCurrentSpan()?.spanContext().traceId;
}

export function getCurrentSpanId(): string | undefined {
  return getCurrentSpan()?.spanContext().spanId;
}

function endSpanWithError(span: Span, err: unknown): void {
  span.recordException(err instanceof Error ? err : new Error(String(err)));
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: err instanceof Error ? err.message : String(err),
  });
  span.end();
}

export function withSpan<T>(name: string, kind: string, fn: (span: Span) => T): T {
  return getTracer().startActiveSpan(
    name,
    { attributes: { 'span.kind': kind } },
    (span) => {
      try {
        const result = fn(span);
        const maybePromise = result as unknown as PromiseLike<unknown> | undefined;
        if (maybePromise && typeof maybePromise.then === 'function') {
          return maybePromise.then(
            (value) => {
              span.end();
              return value;
            },
            (err: unknown) => {
              endSpanWithError(span, err);
              throw err;
            },
          ) as T;
        }
        span.end();
        return result;
      } catch (err) {
        endSpanWithError(span, err);
        throw err;
      }
    },
  );
}
