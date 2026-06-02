import type { UsageInfo } from '@agentx/shared';

export interface TurnMetrics {
  turnId: string;
  sessionId: string;
  providerId: string;
  modelId: string;

  // Timing
  turnStartMs: number;
  turnEndMs: number;
  timeToFirstTokenMs: number;
  providerLatencyMs: number;

  // Token usage
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;

  // Reliability
  retryCount: number;
  failoverCount: number;
  compactionCount: number;

  // Tool execution
  toolCallCount: number;
  toolCallRepairCount: number;
  toolSuccessCount: number;
  toolFailureCount: number;

  // Cost
  cost: number;

  // Metadata
  providerRouteId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface TelemetryEmitterConfig {
  emit: (metrics: TurnMetrics) => void;
  onError?: (error: unknown) => void;
}

export class TelemetryEmitter {
  private config: TelemetryEmitterConfig | null = null;
  private turnMetrics = new Map<string, Partial<TurnMetrics>>();
  private compactionCount = new Map<string, number>();
  private failoverCount = new Map<string, number>();

  configure(config: TelemetryEmitterConfig): void {
    this.config = config;
  }

  startTurn(
    turnId: string,
    sessionId: string,
    providerId: string,
    modelId: string,
  ): void {
    this.turnMetrics.set(turnId, {
      turnId,
      sessionId,
      providerId,
      modelId,
      turnStartMs: Date.now(),
      timeToFirstTokenMs: 0,
      providerLatencyMs: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      retryCount: 0,
      failoverCount: 0,
      compactionCount: 0,
      toolCallCount: 0,
      toolCallRepairCount: 0,
      toolSuccessCount: 0,
      toolFailureCount: 0,
      cost: 0,
    });
  }

  markFirstToken(turnId: string): void {
    const metrics = this.turnMetrics.get(turnId);
    if (metrics && metrics.turnStartMs) {
      metrics.timeToFirstTokenMs = Date.now() - metrics.turnStartMs;
    }
  }

  markRetry(turnId: string): void {
    const metrics = this.turnMetrics.get(turnId);
    if (metrics) {
      metrics.retryCount = (metrics.retryCount ?? 0) + 1;
    }
  }

  markFailover(turnId: string): void {
    const metrics = this.turnMetrics.get(turnId);
    if (metrics) {
      metrics.failoverCount = (metrics.failoverCount ?? 0) + 1;
    }
  }

  markCompaction(sessionId: string): void {
    const count = (this.compactionCount.get(sessionId) ?? 0) + 1;
    this.compactionCount.set(sessionId, count);
  }

  recordToolCall(
    turnId: string,
    success: boolean,
    wasRepaired: boolean = false,
  ): void {
    const metrics = this.turnMetrics.get(turnId);
    if (!metrics) return;

    metrics.toolCallCount = (metrics.toolCallCount ?? 0) + 1;

    if (success) {
      metrics.toolSuccessCount = (metrics.toolSuccessCount ?? 0) + 1;
    } else {
      metrics.toolFailureCount = (metrics.toolFailureCount ?? 0) + 1;
    }

    if (wasRepaired) {
      metrics.toolCallRepairCount = (metrics.toolCallRepairCount ?? 0) + 1;
    }
  }

  endTurn(
    turnId: string,
    usage: UsageInfo,
    sessionId: string,
    providerId: string,
  ): void {
    const metrics = this.turnMetrics.get(turnId);
    if (!metrics) return;

    metrics.turnEndMs = Date.now();
    metrics.promptTokens = usage.promptTokens;
    metrics.completionTokens = usage.completionTokens;
    metrics.totalTokens = usage.totalTokens;
    metrics.cacheReadTokens = usage.cacheReadTokens ?? 0;
    metrics.cacheWriteTokens = usage.cacheWriteTokens ?? 0;
    metrics.cost = usage.cost ?? 0;
    metrics.providerLatencyMs = metrics.turnEndMs - (metrics.turnStartMs ?? metrics.turnEndMs);
    metrics.compactionCount = this.compactionCount.get(sessionId) ?? 0;
    metrics.failoverCount = this.failoverCount.get(providerId) ?? 0;

    if (this.config) {
      try {
        this.config.emit(metrics as TurnMetrics);
      } catch (err) {
        this.config.onError?.(err);
      }
    }

    this.turnMetrics.delete(turnId);
  }

  markError(turnId: string, code: string, message: string): void {
    const metrics = this.turnMetrics.get(turnId);
    if (metrics) {
      metrics.errorCode = code;
      metrics.errorMessage = message;
    }
  }

  getMetrics(turnId: string): Partial<TurnMetrics> | undefined {
    return this.turnMetrics.get(turnId);
  }

  flush(): void {
    for (const [_turnId, metrics] of this.turnMetrics) {
      if (metrics.turnStartMs && !metrics.turnEndMs) {
        metrics.turnEndMs = Date.now();
        if (this.config) {
          try {
            this.config.emit(metrics as TurnMetrics);
          } catch {
            // Silently skip failed emits during flush
          }
        }
      }
    }

    this.turnMetrics.clear();
  }
}
