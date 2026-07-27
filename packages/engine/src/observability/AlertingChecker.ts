/**
 * Alerting checker (v1.1+) — periodically evaluates alerting rules against
 * recent traces and inserts alerts when SLOs are breached.
 *
 * Runs on a fixed interval (default: 5 minutes). Each tick calls
 * `store.evaluateAlerts()` which checks error-rate and p95 latency against
 * the configured thresholds.
 */
import type { ObservabilityStore } from './ObservabilityStore.js';
import { getLogger } from '@agentx/shared';

const logger = getLogger();

export class AlertingChecker {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private store: ObservabilityStore,
    private intervalMs: number = 5 * 60 * 1000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.running = true;
    // Run immediately, then on interval.
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    try {
      const alerts = await this.store.evaluateAlerts();
      for (const a of alerts) {
        logger.warn('OBSERVABILITY_ALERT', a.message, { type: a.type, severity: a.severity });
      }
    } catch (err) {
      logger.error('OBSERVABILITY_ALERT', err instanceof Error ? err : new Error('alerting tick failed'), { method: 'tick' });
    }
  }

  async shutdown(): Promise<void> {
    this.stop();
  }
}
