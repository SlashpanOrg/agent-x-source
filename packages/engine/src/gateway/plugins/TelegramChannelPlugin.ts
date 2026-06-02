import type { ChannelPlugin } from '../types.js';
import type { VisualUpdate } from '@agentx/shared';
import { TelegramBridge } from '../../telegram/TelegramBridge.js';
import type { TelegramConfig } from '../../telegram/TelegramBridge.js';

export class TelegramChannelPlugin implements ChannelPlugin {
  readonly id = 'telegram';
  readonly name = 'Telegram Bot';
  readonly version = '1.0.0';
  readonly description = 'Telegram messaging channel for Agent-X';

  private bridge: TelegramBridge;
  private pendingResponses = new Map<string, (text: string) => void>();

  constructor(config: TelegramConfig) {
    this.bridge = new TelegramBridge(config);
  }

  async onLoad(): Promise<void> {
    // No-op: bridge is created in constructor
  }

  async onStart(): Promise<void> {
    this.bridge.setMessageHandler((_text: string, _chatId: number) => {
      // Messages are delegated to agent via the bridge's built-in sendMessage flow
    });

    await this.bridge.start();
  }

  async onStop(): Promise<void> {
    this.bridge.stop();
    this.pendingResponses.clear();
  }

  async handleIncoming(payload: Record<string, unknown>): Promise<{ text: string; userId: string; channelId: string }> {
    const text = (payload['text'] as string) || '';
    const userId = (payload['from_id'] as string) || 'unknown';
    const chatId = (payload['chat_id'] as string) || 'unknown';

    return { text, userId, channelId: chatId };
  }

  async handleOutgoing(text: string, metadata: Record<string, unknown>): Promise<Record<string, unknown>> {
    const chatId = (metadata['channelId'] as string) || (metadata['userId'] as string) || '';
    const chatIdNum = parseInt(chatId, 10) || 0;

    if (chatIdNum > 0) {
      await this.bridge.sendMessage(chatIdNum, text);
    }

    return { ok: true, text, chatId };
  }

  async handleVisualUpdate(update: VisualUpdate): Promise<Record<string, unknown> | null> {
    switch (update.type) {
      case 'text_update':
        return { type: 'text', content: update.unstableText };
      case 'tool_card':
        return {
          type: 'tool',
          name: update.card.name,
          status: update.card.status,
          icon: update.card.icon,
        };
      case 'compaction_toast':
        return { type: 'status', message: update.action === 'start' ? 'Compacting...' : 'Compacted' };
      case 'toast':
        return { type: 'error', message: update.message };
      default:
        return null;
    }
  }

  isHealthy(): boolean {
    return this.bridge.isRunning();
  }

  /** Access the underlying bridge for direct operations */
  getBridge(): TelegramBridge {
    return this.bridge;
  }
}
