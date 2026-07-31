/**
 * In-memory counter for channel events (`channel_events_total{type,event}`).
 *
 * The engine package cannot import the web-api `MetricsRegistry` (would create a
 * circular dependency), so we maintain a lightweight in-memory counter here and
 * expose it as a {@link MetricSource} that the `MetricsSampler` polls periodically.
 *
 * Domain is tagged `APP` so the metric is grouped with other app-domain metrics
 * in the observability UI.
 */
import type { MetricSample } from '@agentx/shared';
import type { MetricSource } from './MetricsSampler.js';

export type ChannelType = 'whatsapp' | 'discord' | 'telegram' | 'slack' | 'email';
export type ChannelEvent = 'message' | 'connect' | 'disconnect';

interface CounterKey {
  type: string;
  event: string;
}

const counters = new Map<string, number>();

function keyFor(k: CounterKey): string {
  return `type=${k.type},event=${k.event}`;
}

/**
 * Increment the `channel_events_total` counter for the given channel type and
 * event. Safe to call before observability is initialised — the counter is
 * in-memory and will be picked up by the `MetricsSampler` once it starts.
 */
export function incrementChannelEvent(type: ChannelType | string, event: ChannelEvent | string): void {
  const key = keyFor({ type, event });
  counters.set(key, (counters.get(key) ?? 0) + 1);
}

/**
 * Snapshot all accumulated channel event counters as `MetricSample`s.
 * Used internally by {@link channelMetricSource}.
 */
export function snapshotChannelMetrics(): MetricSample[] {
  const samples: MetricSample[] = [];
  for (const [key, value] of counters.entries()) {
    const labels: Record<string, string> = {};
    for (const part of key.split(',')) {
      const eq = part.indexOf('=');
      if (eq > 0) labels[part.slice(0, eq)] = part.slice(eq + 1);
    }
    samples.push({
      name: 'channel_events_total',
      value,
      labels: { ...labels, domain: 'APP' },
      timestamp: Date.now(),
    });
  }
  return samples;
}

/**
 * A {@link MetricSource} that exposes `channel_events_total{type,event}` to the
 * `MetricsSampler`. Register it via `metricsSampler.addSource(channelMetricSource)`
 * or pass it in `initObservability({ metricSources: [channelMetricSource] })`.
 */
export const channelMetricSource: MetricSource = {
  name: 'channel-events',
  snapshot: snapshotChannelMetrics,
};
