import type { ChannelPlugin, ChannelRegistryEntry } from './types.js';
import type { Agent } from '../agent/Agent.js';
import type { VisualUpdate } from '@agentx/shared';

export class ChannelRegistry {
  private channels = new Map<string, ChannelRegistryEntry>();
  private agentRef: Agent | null = null;

  setAgent(agent: Agent): void {
    this.agentRef = agent;
  }

  register(plugin: ChannelPlugin): void {
    this.channels.set(plugin.id, {
      plugin,
      enabled: false,
      stats: {
        messagesReceived: 0,
        messagesSent: 0,
        errors: 0,
        lastActivity: 0,
      },
    });
  }

  async startChannel(channelId: string): Promise<void> {
    const entry = this.channels.get(channelId);
    if (!entry) throw new Error(`Channel "${channelId}" not registered`);

    await entry.plugin.onLoad?.();
    await entry.plugin.onStart?.();
    entry.enabled = true;
  }

  async stopChannel(channelId: string): Promise<void> {
    const entry = this.channels.get(channelId);
    if (!entry) return;

    await entry.plugin.onStop?.();
    entry.enabled = false;
  }

  async handleIncoming(
    channelId: string,
    payload: Record<string, unknown>,
  ): Promise<string | null> {
    const entry = this.channels.get(channelId);
    if (!entry || !entry.enabled) return null;

    try {
      const parsed = await entry.plugin.handleIncoming(payload);
      entry.stats.messagesReceived++;
      entry.stats.lastActivity = Date.now();

      if (this.agentRef) {
        const response = await this.agentRef.sendMessage(parsed.text);
        entry.stats.messagesSent++;

        const formatted = await entry.plugin.handleOutgoing(response.content, {
          messageId: response.id,
          userId: parsed.userId,
        });

        return JSON.stringify(formatted);
      }

      // No agent — return raw parsed text
      entry.stats.messagesSent++;
      const formatted = await entry.plugin.handleOutgoing(parsed.text, {
        userId: parsed.userId,
      });
      return JSON.stringify(formatted);
    } catch (err) {
      entry.stats.errors++;
      throw err;
    }
  }

  async broadcastVisual(channelId: string, update: VisualUpdate): Promise<void> {
    const entry = this.channels.get(channelId);
    if (!entry || !entry.enabled) return;

    if (entry.plugin.handleVisualUpdate) {
      await entry.plugin.handleVisualUpdate(update);
    }
  }

  broadcastToAll(update: VisualUpdate): void {
    for (const [, entry] of this.channels) {
      if (entry.enabled && entry.plugin.handleVisualUpdate) {
        entry.plugin.handleVisualUpdate(update).catch(() => {});
      }
    }
  }

  getChannel(channelId: string): ChannelRegistryEntry | undefined {
    return this.channels.get(channelId);
  }

  listChannels(): Array<{ id: string; name: string; enabled: boolean; description: string }> {
    return Array.from(this.channels.entries()).map(([id, entry]) => ({
      id,
      name: entry.plugin.name,
      enabled: entry.enabled,
      description: entry.plugin.description,
    }));
  }

  getStats(channelId: string): ChannelRegistryEntry['stats'] | undefined {
    return this.channels.get(channelId)?.stats;
  }
}
