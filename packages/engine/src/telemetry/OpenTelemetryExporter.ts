import type { TelemetryBus, TelemetryEvent, MetricSample } from '@agentx/shared';

interface OTelConfig {
  endpoint?: string;
  serviceName?: string;
  enabled: boolean;
}

export class OpenTelemetryExporter {
  private config: OTelConfig;
  private metrics: MetricSample[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<OTelConfig>) {
    this.config = {
      enabled: config?.enabled ?? false,
      endpoint: config?.endpoint ?? process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318/v1/traces',
      serviceName: config?.serviceName ?? process.env['OTEL_SERVICE_NAME'] ?? 'agent-x',
    };
  }

  get isEnabled(): boolean {
    return this.config.enabled;
  }

  attach(bus: TelemetryBus): () => void {
    if (!this.config.enabled) return () => {};

    const unsubEvent = bus.onEvent((event: TelemetryEvent) => {
      this.recordEvent(event);
    });

    const unsubMetric = bus.onMetric((sample: MetricSample) => {
      this.metrics.push(sample);
    });

    this.flushTimer = setInterval(() => this.flush(), 30_000);

    return () => {
      unsubEvent();
      unsubMetric();
      if (this.flushTimer) clearInterval(this.flushTimer);
      this.flush();
    };
  }

  private recordEvent(event: TelemetryEvent): void {
    this.metrics.push({
      name: `agentx.${event.type}`,
      value: 1,
      labels: {
        sessionId: event.sessionId ?? '',
        ...(event.metadata as Record<string, string>),
      },
      timestamp: Date.now(),
    });
  }

  private async flush(): Promise<void> {
    if (this.metrics.length === 0) return;
    const batch = this.metrics.splice(0);
    try {
      await fetch(this.config.endpoint!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceSpans: [{
            resource: { attributes: [{ key: 'service.name', value: { stringValue: this.config.serviceName } }] },
            scopeSpans: [{
              scope: { name: 'agent-x' },
              spans: batch.map((m, i) => ({
                traceId: `agentx${Date.now().toString(36)}`,
                spanId: `span${i.toString(16).padStart(14, '0')}`,
                name: m.name,
                startTimeUnixNano: String((m.timestamp ?? Date.now()) * 1_000_000),
                endTimeUnixNano: String(Date.now() * 1_000_000),
                attributes: Object.entries(m.labels ?? {}).map(([k, v]) => ({ key: k, value: { stringValue: String(v) } })),
              })),
            }],
          }],
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Telemetry is non-critical
    }
  }
}
