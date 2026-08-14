/**
 * WhatsAppBridgeAdapter — IChannelBridge for WhatsApp.
 *
 * Inbound is classified by WhatsAppJarvisRouter (owner self-chat vs world).
 * The adapter does not auto-reply to contacts. Outbound ChannelService.send
 * is used by owner-initiated tools.
 */
import type { OutboundMessage, ChannelStatus, ChannelAttachment } from '../IChannelService.js';
import type { IChannelBridge, OnInboundCallback } from '../IChannelBridge.js';
import type { WhatsAppSessionService } from '../../../whatsapp/WhatsAppSessionService.js';
import type { WhatsAppIncomingMessage } from '../../../whatsapp/engine/IWhatsAppEngine.js';
import { EngineStatus } from '../../../whatsapp/engine/IWhatsAppEngine.js';
import type { WhatsAppJarvisRouter } from '../../../whatsapp/jarvis/WhatsAppJarvisRouter.js';
import { getLogger } from '@agentx/shared';
import { withSpan } from '../../../observability/index.js';
import { incrementChannelEvent } from '../../../observability/channel-metrics.js';

export interface WhatsAppBridgeAdapterConfig {
  sessionService: WhatsAppSessionService;
  jarvisRouter?: WhatsAppJarvisRouter;
}

export class WhatsAppBridgeAdapter implements IChannelBridge {
  private readonly sessionService: WhatsAppSessionService;
  private readonly jarvisRouter?: WhatsAppJarvisRouter;
  private onInbound: OnInboundCallback | null = null;
  private inboundCount = 0;
  private outboundCount = 0;
  private lastInbound?: string;
  private lastOutbound?: string;
  private messageUnsubscribe: (() => void) | null = null;

  constructor(config: WhatsAppBridgeAdapterConfig) {
    this.sessionService = config.sessionService;
    this.jarvisRouter = config.jarvisRouter;
  }

  async start(onInbound: OnInboundCallback): Promise<void> {
    this.onInbound = onInbound;
    incrementChannelEvent('whatsapp', 'connect');
    void withSpan('channel.lifecycle', 'channel', (span) => {
      span.setAttribute('trace.domain', 'APP');
      span.setAttribute('trace.kind', 'channel_event');
      span.setAttribute('channel.type', 'whatsapp');
      span.setAttribute('channel.event', 'connect');
      span.setAttribute('channel.status', 'connected');
    });

    const handler = (msg: WhatsAppIncomingMessage) => {
      this.handleInboundMessage(msg);
    };
    this.sessionService.events.on('message', handler);
    this.messageUnsubscribe = () => this.sessionService.events.off('message', handler);
  }

  async stop(): Promise<void> {
    if (this.messageUnsubscribe) {
      this.messageUnsubscribe();
      this.messageUnsubscribe = null;
    }
    const hadInbound = this.onInbound !== null;
    this.onInbound = null;
    if (hadInbound) {
      incrementChannelEvent('whatsapp', 'disconnect');
      void withSpan('channel.lifecycle', 'channel', (span) => {
        span.setAttribute('trace.domain', 'APP');
        span.setAttribute('trace.kind', 'channel_event');
        span.setAttribute('channel.type', 'whatsapp');
        span.setAttribute('channel.event', 'disconnect');
        span.setAttribute('channel.status', 'disconnected');
      });
    }
  }

  async send(message: OutboundMessage): Promise<void> {
    const chatId = message.threadId;
    if (!chatId) {
      throw new Error('WhatsApp chat id (threadId) is required to send a message');
    }

    const status = await this.sessionService.getStatus();
    if (status.status !== EngineStatus.READY) {
      throw new Error(`WhatsApp session is not ready (current status: ${status.status})`);
    }

    const text = this.buildOutboundText(message);
    if (text) {
      await withSpan('channel.outbound', 'channel', async (span) => {
        span.setAttribute('trace.domain', 'APP');
        span.setAttribute('trace.kind', 'channel_event');
        span.setAttribute('channel.type', 'whatsapp');
        span.setAttribute('channel.to', chatId);
        span.setAttribute('channel.message_type', message.attachments && message.attachments.length > 0 ? 'mixed' : 'text');
        const engine = this.sessionService.getEngine();
        if (!engine) {
          throw new Error('WhatsApp engine is not available — session may not be linked');
        }
        const sent = await engine.sendText(chatId, text);
        if (sent?.messageId) this.sessionService.rememberOutboundId(sent.messageId);
        this.outboundCount++;
        this.lastOutbound = new Date().toISOString();
      });
    }
  }

  getStatus(): ChannelStatus {
    const connected = this.onInbound !== null;
    return {
      channel: 'whatsapp',
      connected,
      lastInbound: this.lastInbound,
      lastOutbound: this.lastOutbound,
      details: {
        inboundCount: this.inboundCount,
        outboundCount: this.outboundCount,
        mode: 'jarvis',
      },
    };
  }

  private handleInboundMessage(msg: WhatsAppIncomingMessage): void {
    if (!this.onInbound && !this.jarvisRouter) return;

    this.inboundCount++;
    this.lastInbound = new Date().toISOString();
    incrementChannelEvent('whatsapp', 'message');

    void withSpan('channel.inbound', 'channel', (span) => {
      span.setAttribute('trace.domain', 'APP');
      span.setAttribute('trace.kind', 'channel_event');
      span.setAttribute('channel.type', 'whatsapp');
      span.setAttribute('channel.event', 'message');
      span.setAttribute('channel.from', msg.author ?? msg.from);
      span.setAttribute('channel.message_id', msg.id);
    });

    if (this.jarvisRouter) {
      void this.jarvisRouter.handleIncoming(msg);
      return;
    }

    getLogger().info('WHATSAPP_BRIDGE', 'No Jarvis router — inbound dropped (fail closed)');
  }

  private buildOutboundText(message: OutboundMessage): string {
    let text = message.text;
    if (message.attachments && message.attachments.length > 0) {
      const attNotes = message.attachments.map((att) => this.attachmentNote(att)).filter(Boolean);
      if (attNotes.length > 0) {
        text = `${text}\n${attNotes.join('\n')}`;
      }
    }
    return text;
  }

  private attachmentNote(att: ChannelAttachment): string {
    if (att.url) {
      return `[attachment: ${att.name ?? 'file'} — ${att.url}]`;
    }
    if (att.content) {
      return `[attachment: ${att.name ?? 'file'} — inline content]`;
    }
    return '';
  }
}
