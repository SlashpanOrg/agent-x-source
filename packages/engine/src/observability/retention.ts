import { getLogger } from '@agentx/shared';
import { ObservabilityStore } from './ObservabilityStore.js';

const logger = getLogger();

export class RetentionPurger {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private store: ObservabilityStore,
    private intervalMs = 24 * 60 * 60 * 1000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.runOnce(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(): Promise<void> {
    try {
      const config = await this.store.getConfig();
      if (!config) return;
      const days = config.retention_days;
      await this.store.purgeOlderThan(days);
      logger.info('OBS_PURGE', `Purge completed for retention_days=${days}`);
    } catch (err) {
      logger.error('OBSERVABILITY_RETENTION', err instanceof Error ? err : new Error('retention purge failed'));
    }
  }

  async shutdown(): Promise<void> {
    this.stop();
    await this.runOnce();
  }
}
