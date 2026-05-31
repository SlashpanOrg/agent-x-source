export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

export interface MetricDefinition {
  name: string;
  type: MetricType;
  help: string;
  labelNames?: string[];
  unit?: string;
}

export interface MetricSample {
  name: string;
  value: number;
  labels?: Record<string, string>;
  timestamp?: number;
}

export type TelemetryEventType =
  | 'llm_request'
  | 'llm_response'
  | 'tool_execution'
  | 'session_created'
  | 'session_restored'
  | 'session_deleted'
  | 'error'
  | 'permission_granted'
  | 'permission_denied'
  | 'agent_action'
  | 'plugin_loaded'
  | 'plugin_unloaded'
  | 'memory_extracted'
  | 'compaction_triggered';

export interface TelemetryEvent {
  type: TelemetryEventType;
  timestamp: string;
  sessionId?: string;
  duration?: number;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface TelemetryBus {
  // Metric operations
  increment(name: string, value?: number, labels?: Record<string, string>): void;
  gauge(name: string, value: number, labels?: Record<string, string>): void;
  observe(name: string, value: number, labels?: Record<string, string>): void;

  // Event logging
  emit(event: TelemetryEvent): void;

  // Snapshot for Prometheus exposition
  snapshot(): MetricSample[];

  // Subscriber pattern for SSE / WS relay
  onEvent(handler: (event: TelemetryEvent) => void): () => void;
  onMetric(handler: (sample: MetricSample) => void): () => void;

  // Lifecycle
  start(): void;
  stop(): void;
}

export interface TelemetryConfig {
  enabled: boolean;
  prometheusEndpoint?: string;
  metricsPrefix?: string;
  sampleRate?: number;
}
