import type { MetricSample } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { ObservabilityStore } from './ObservabilityStore.js';

const logger = getLogger();

export interface MetricSource {
  name: string;
  snapshot: () => MetricSample[];
}

/**
 * Downsample a histogram sample into _count/_sum/_p50/_p90/_p99 metric points.
 * Histogram samples arrive as a single sample whose `value` is an object with
 * `count`, `sum`, and optionally `buckets`/`quantiles`. We emit one metric row
 * per statistic so the UI can chart latency distributions without storing every
 * bucket.
 */
export function downsampleHistogram(sample: MetricSample): MetricSample[] {
  const value = sample.value as unknown as Record<string, unknown>;
  if (!value || typeof value !== 'object') return [];
  const labels = sample.labels ?? {};
  const out: MetricSample[] = [];
  const push = (suffix: string, v: unknown) => {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isNaN(n)) {
      out.push({ name: `${sample.name}.${suffix}`, value: n, labels, timestamp: sample.timestamp });
    }
  };
  push('_count', value['count']);
  push('_sum', value['sum']);
  push('_p50', value['p50'] ?? value['median']);
  push('_p90', value['p90']);
  push('_p99', value['p99']);
  return out;
}

/** Agent-metrics source builder: turns a `getAgentMetrics()` API into a source. */
export interface AgentMetricsApi {
  getAgentMetrics(): AgentMetricsSnapshot;
}

export interface AgentMetricsSnapshot {
  turnsTotal?: number;
  toolLatencyAvgMs?: number;
  toolLatencyP95Ms?: number;
  toolCallCount?: number;
  queueDepth?: number;
  memoryCacheHitRate?: number;
}

export function buildAgentMetricSource(api: AgentMetricsApi): MetricSource {
  return {
    name: 'agent',
    snapshot: () => {
      const m = api.getAgentMetrics();
      const out: MetricSample[] = [];
      const push = (name: string, v: unknown) => {
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isNaN(n)) out.push({ name, value: n, labels: { domain: 'AGENT' } });
      };
      push('agent.turns.total', m.turnsTotal);
      push('agent.tool.latency.avg_ms', m.toolLatencyAvgMs);
      push('agent.tool.latency.p95_ms', m.toolLatencyP95Ms);
      push('agent.tool.call_count', m.toolCallCount);
      push('agentx_exporter_queue_depth', m.queueDepth);
      push('agentx_memory_cache_hit_rate', m.memoryCacheHitRate);
      return out;
    },
  };
}

export class MetricsSampler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;

  constructor(
    private store: ObservabilityStore,
    private sources: MetricSource[] = [],
    intervalMs?: number,
  ) {
    this.intervalMs = intervalMs ?? 15000;
  }

  setSources(sources: MetricSource[]): void {
    this.sources = sources;
  }

  addSource(source: MetricSource): void {
    if (!this.sources.includes(source)) this.sources.push(source);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sample(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async sample(): Promise<void> {
    const now = new Date().toISOString();
    const rows: { ts: string; name: string; value: number; labels: Record<string, string> }[] = [];
    for (const source of this.sources) {
      let samples: MetricSample[];
      try {
        samples = source.snapshot();
      } catch (err) {
        logger.error('OBSERVABILITY_METRICS', err instanceof Error ? err : new Error(`snapshot failed for ${source.name}`));
        continue;
      }
      for (const s of samples) {
        // Histogram samples: value is an object with count/sum/quantiles.
        if (s.value && typeof s.value === 'object' && !Array.isArray(s.value)) {
          for (const ds of downsampleHistogram(s)) {
            const value = typeof ds.value === 'number' ? ds.value : Number(ds.value);
            if (Number.isNaN(value)) continue;
            rows.push({
              ts: ds.timestamp ? new Date(ds.timestamp).toISOString() : now,
              name: ds.name,
              value,
              labels: { ...(ds.labels ?? {}), domain: ds.labels?.domain ?? 'AGENT' },
            });
          }
          continue;
        }
        const value = typeof s.value === 'number' ? s.value : Number(s.value);
        if (Number.isNaN(value)) continue;
        rows.push({
          ts: s.timestamp ? new Date(s.timestamp).toISOString() : now,
          name: s.name,
          value,
          labels: { ...(s.labels ?? {}), domain: s.labels?.domain ?? 'APP' },
        });
      }
    }
    if (rows.length === 0) return;
    try {
      await this.store.insertMetricSamples(rows);
    } catch (err) {
      logger.error('OBSERVABILITY_METRICS', err instanceof Error ? err : new Error('metric sample insert failed'));
    }
  }

  async shutdown(): Promise<void> {
    this.stop();
    await this.sample();
  }
}
