import { Pool } from 'pg';
import type { TelemetryBus } from '@agentx/shared';
import { clearLogSinks, getLogger, registerLogSink } from '@agentx/shared';
import { ObservabilityStore } from './ObservabilityStore.js';
import { PostgresLogExporter } from './PostgresLogExporter.js';
import { MetricsSampler, buildAgentMetricSource, type AgentMetricsApi, type MetricSource } from './MetricsSampler.js';
import { RetentionPurger } from './retention.js';
import { AlertingChecker } from './AlertingChecker.js';
import { initTracer, shutdownTracer, isTracerEnabled } from './tracer.js';

export {
  getTracer,
  getCurrentSpan,
  getCurrentTraceId,
  getCurrentSpanId,
  withSpan,
  getSpanExporter,
} from './tracer.js';
export { context } from '@opentelemetry/api';
export { startAppSpan, endAppSpan } from './app-span.js';
export type { AppSpan } from './app-span.js';
export { runWithTurnContext, getTurnContext, injectTraceparent, extractTraceparent } from './context.js';
export { ObservabilityStore } from './ObservabilityStore.js';
export type { ListTracesFilters, ListLogsFilters } from './ObservabilityStore.js';
export { redactAttributes, redactText } from './redact.js';
export { buildAgentMetricSource, downsampleHistogram, type AgentMetricsApi, type AgentMetricsSnapshot } from './MetricsSampler.js';
export type { MetricSource } from './MetricsSampler.js';
export { setSpanMetricsSink } from './PostgresSpanExporter.js';
export type { SpanMetricsSink } from './PostgresSpanExporter.js';
export { AlertingChecker } from './AlertingChecker.js';
export { incrementChannelEvent, snapshotChannelMetrics, channelMetricSource, type ChannelType, type ChannelEvent } from './channel-metrics.js';

const logger = getLogger();

export interface ObservabilityDeps {
  telemetryBus?: TelemetryBus;
  metricSources?: MetricSource[];
  /**
   * The web-api {@link AgentMetricsApi} (e.g. the ApiService adapter) used to
   * publish AGENT-domain metrics (turns, tool latency, queue depth, cache hit
   * rate) into the sampler. When omitted, the agent metric source is skipped.
   */
  api?: AgentMetricsApi;
}

export interface ObservabilityHandle {
  store: ObservabilityStore;
  logExporter: PostgresLogExporter;
  metricsSampler: MetricsSampler;
  retentionPurger: RetentionPurger;
  alertingChecker: AlertingChecker;
  isEnabled: () => boolean;
  reloadConfig: () => Promise<void>;
  stop: () => Promise<void>;
}

let handle: ObservabilityHandle | undefined;

export async function initObservability(pool: Pool, deps: ObservabilityDeps = {}): Promise<ObservabilityHandle> {
  if (handle) return handle;

  // Create a dedicated small pool for observability reads/writes (§13.5).
  // This isolates observability load from the app's storage pool so heavy
  // trace queries can't starve the app's turn writes.
  const obsPoolSize = envInt('AGENTX_OBS_PG_POOL_SIZE', 2);
  const obsPool = new Pool({
    connectionString: pool.options.connectionString,
    max: obsPoolSize,
    idleTimeoutMillis: 30000,
    application_name: 'agentx-observability',
  });

  const store = new ObservabilityStore(obsPool);
  const config = await store.getConfig();
  const enabled = config?.enabled ?? true;
  const capturePrompts = config?.capture_prompts ?? true;
  const retentionDays = config?.retention_days ?? 30;

  // Live config accessor so the span exporter redacts prompts when the config
  // flips at runtime (without restarting the tracer).
  let liveCapturePrompts = capturePrompts;
  const getCapturePrompts = () => liveCapturePrompts;

  initTracer(store, {
    enabled,
    batchSize: envInt('AGENTX_OBS_BATCH_SIZE', 512),
    flushMs: envInt('AGENTX_OBS_FLUSH_MS', 5000),
    getCapturePrompts,
    otlp: {
      otlp_enabled: config?.otlp_enabled,
      otlp_endpoint: config?.otlp_endpoint,
      otlp_protocol: config?.otlp_protocol,
      otlp_headers: config?.otlp_headers,
    },
  });

  const logExporter = new PostgresLogExporter(store);
  // Wire the shared logger's durable sink fan-out (§8.1) so every
  // `getLogger().info('AI_SDK', ...)` etc. auto-attaches to the active
  // trace/span context and persists to `observability.logs`. The sink level
  // gate (`AGENTX_OBS_LOG_LEVEL`, default 'info') is enforced inside the
  // logger before this sink is invoked.
  registerLogSink(logExporter.asLogSink());
  const metricsSampler = new MetricsSampler(
    store,
    buildMetricSources(deps),
    envInt('AGENTX_OBS_METRICS_INTERVAL_MS', 15000),
  );
  const retentionPurger = new RetentionPurger(
    store,
    envInt('AGENTX_OBS_PURGE_INTERVAL_MS', 24 * 60 * 60 * 1000),
  );
  const alertingChecker = new AlertingChecker(store, 5 * 60 * 1000);

  if (enabled) {
    logExporter.start();
    metricsSampler.start();
    retentionPurger.start();
    alertingChecker.start();
    logger.info('OBSERVABILITY', 'Observability initialized', { retentionDays, capturePrompts });
  } else {
    logger.info('OBSERVABILITY', 'Observability disabled');
  }

  const h: ObservabilityHandle = {
    store,
    logExporter,
    metricsSampler,
    retentionPurger,
    alertingChecker,
    isEnabled: () => isTracerEnabled(),
    reloadConfig: async () => {
      const cfg = await store.getConfig();
      const nowEnabled = cfg?.enabled ?? true;
      liveCapturePrompts = cfg?.capture_prompts ?? true;
      if (nowEnabled && !isTracerEnabled()) {
        initTracer(store, {
          enabled: true,
          getCapturePrompts,
          otlp: {
            otlp_enabled: cfg?.otlp_enabled,
            otlp_endpoint: cfg?.otlp_endpoint,
            otlp_protocol: cfg?.otlp_protocol,
            otlp_headers: cfg?.otlp_headers,
          },
        });
        logExporter.start();
        metricsSampler.start();
        retentionPurger.start();
        alertingChecker.start();
      } else if (!nowEnabled && isTracerEnabled()) {
        await shutdownTracer();
        logExporter.stop();
        metricsSampler.stop();
        retentionPurger.stop();
        alertingChecker.stop();
      }
    },
    stop: async () => {
      await shutdownTracer();
      logExporter.stop();
      await logExporter.shutdown();
      // Detach the durable log sink so a post-shutdown logger call cannot
      // buffer into a dead exporter (§8.1).
      clearLogSinks();
      metricsSampler.stop();
      await metricsSampler.shutdown();
      retentionPurger.stop();
      alertingChecker.stop();
      await alertingChecker.shutdown();
      // Close the dedicated observability pool (§13.5).
      await obsPool.end();
    },
  };

  handle = h;
  return h;
}

export async function shutdownObservability(): Promise<void> {
  await handle?.stop();
  handle = undefined;
}

export function getObservabilityHandle(): ObservabilityHandle | undefined {
  return handle;
}

function buildMetricSources(deps: ObservabilityDeps): MetricSource[] {
  const sources: MetricSource[] = [...(deps.metricSources ?? [])];
  if (deps.telemetryBus) {
    sources.push({
      name: 'telemetry-bus',
      snapshot: () => deps.telemetryBus!.snapshot(),
    });
  }
  // AGENT-domain metrics (turns, tool latency, queue depth, cache hit rate)
  // sourced from the web-api ApiService via the {@link AgentMetricsApi}
  // adapter (§8.2). All samples are tagged `labels.domain='AGENT'`.
  if (deps.api) {
    sources.push(buildAgentMetricSource(deps.api));
  }
  return sources;
}

function envInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}
