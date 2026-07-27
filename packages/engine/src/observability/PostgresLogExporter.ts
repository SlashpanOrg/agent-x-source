import type { LogSink, ObservabilityDomain, ObservabilityLogEntry } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { ObservabilityStore } from './ObservabilityStore.js';
import { getCurrentSpan } from './tracer.js';
import { getTurnContext } from './context.js';

const logger = getLogger();

export interface PostgresLogRecord {
  level: 'debug' | 'info' | 'warn' | 'error';
  scope?: string;
  message: string;
  payload?: Record<string, unknown>;
}

export interface PostgresLogExporterOptions {
  /** Ring-buffer capacity; when full the oldest entries are dropped. */
  ringBufferSize?: number;
  /** Max entries before a forced flush. */
  maxSize?: number;
  /** Time between automatic flushes. */
  flushMs?: number;
}

export class PostgresLogExporter {
  private buffer: ObservabilityLogEntry[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly ringBufferMax: number;
  private readonly maxSize: number;
  private readonly flushMs: number;
  /** Number of log entries dropped due to backpressure. */
  droppedCount = 0;

  constructor(
    private store: ObservabilityStore,
    opts: PostgresLogExporterOptions = {},
  ) {
    this.ringBufferMax = opts.ringBufferSize ?? 2048;
    this.maxSize = opts.maxSize ?? 256;
    this.flushMs = opts.flushMs ?? 2000;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), this.flushMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  emit(record: PostgresLogRecord): void {
    const span = getCurrentSpan();
    const spanContext = span?.spanContext();
    const rawSpan = (span as unknown) as { attributes?: Record<string, unknown> } | undefined;
    const attrs = rawSpan?.attributes ?? {};
    const turn = getTurnContext();

    const entry: ObservabilityLogEntry = {
      id: 0,
      ts: new Date().toISOString(),
      domain: ((attrs['trace.domain'] as ObservabilityDomain) ?? 'AGENT'),
      level: record.level,
      scope: record.scope,
      message: record.message,
      trace_id: spanContext?.traceId,
      span_id: spanContext?.spanId,
      session_id: turn?.sessionId ?? (attrs['session.id'] ? String(attrs['session.id']) : undefined),
      payload: record.payload,
    };

    if (this.buffer.length >= this.ringBufferMax) {
      this.buffer.shift();
      this.droppedCount += 1;
      logger.warn('OBS_LOG_DROP', `Log ring buffer full (${this.ringBufferMax}); dropping oldest. Total dropped: ${this.droppedCount}`);
    }
    this.buffer.push(entry);
    if (this.buffer.length >= this.maxSize) {
      this.flush().catch((err) => logger.error('OBSERVABILITY_LOG', err instanceof Error ? err : new Error('log flush failed')));
    }
  }

  /**
   * Returns a sink function compatible with the shared logger's transport hook.
   * The logger (§8.1) calls this for every log record; the sink captures the
   * current trace/span context and buffers the entry for batched insert.
   */
  getLoggerSink(): (record: PostgresLogRecord) => void {
    return (record) => this.emit(record);
  }

  /**
   * Returns a {@link LogSink} adapter for the shared logger's `registerLogSink`
   * fan-out (§8.1). The logger hands over a {@link LogSinkRecord}; this adapter
   * captures the active trace/span/turn context at call time and buffers the
   * entry for batched Postgres insert.
   */
  asLogSink(): LogSink {
    return {
      log: (record) => {
        this.emit({
          level: record.level,
          scope: record.scope,
          message: record.message,
          payload: record.payload,
        });
      },
    };
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    try {
      await this.store.insertLogs(batch.map((r) => ({
        trace_id: r.trace_id,
        span_id: r.span_id,
        session_id: r.session_id,
        domain: r.domain,
        ts: r.ts,
        level: r.level,
        scope: r.scope,
        message: r.message,
        payload: r.payload,
      })));
    } catch (err) {
      logger.error('OBSERVABILITY_LOG', err instanceof Error ? err : new Error('log flush failed'));
    }
  }

  async shutdown(): Promise<void> {
    this.stop();
    await this.flush();
  }
}
