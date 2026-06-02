import type { Agent } from '../agent/Agent.js';
import { ChannelRegistry } from './ChannelRegistry.js';
import { TelegramChannelPlugin } from './plugins/TelegramChannelPlugin.js';
import { WebSocketChannelPlugin } from './plugins/WebSocketChannelPlugin.js';
import type { GatewayConfig } from './types.js';

export class Gateway {
  readonly registry = new ChannelRegistry();
  private config: GatewayConfig;

  constructor(config: Partial<GatewayConfig> = {}) {
    this.config = {
      port: config.port ?? 18789,
      host: config.host ?? '127.0.0.1',
      maxConcurrentSessions: config.maxConcurrentSessions ?? 4,
      rateLimitPerMinute: config.rateLimitPerMinute ?? 30,
      authRequired: config.authRequired ?? false,
    };

    // Register built-in channel plugins
    this.registry.register(new WebSocketChannelPlugin());
  }

  /** Attach to an Agent instance so channels can route messages to it */
  attachAgent(agent: Agent): void {
    this.registry.setAgent(agent);
  }

  /** Register a Telegram channel with the given bot token */
  registerTelegram(botToken: string, allowedUserIds?: number[]): void {
    this.registry.register(new TelegramChannelPlugin({ botToken, allowedUserIds }));
  }

  async startChannel(channelId: string): Promise<void> {
    await this.registry.startChannel(channelId);
  }

  async stopChannel(channelId: string): Promise<void> {
    await this.registry.stopChannel(channelId);
  }

  getConfig(): GatewayConfig {
    return { ...this.config };
  }
}
