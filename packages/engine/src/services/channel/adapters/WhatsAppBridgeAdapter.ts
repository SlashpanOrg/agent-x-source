/**
 * WhatsAppBridgeAdapter — IChannelBridge adapter for WhatsApp.
 *
 * Per §5.2 of WHATSAPP_INTEGRATION_PLAN.md, this is a direct structural peer of
 * `TelegramBridgeAdapter.ts` / `DiscordBridgeAdapter.ts`. The key difference:
 * instead of wrapping a raw socket directly, it subscribes to
 * {@link WhatsAppEventBus} (§3.6) for inbound events and delegates outbound
 * sends to the {@link WhatsAppSessionService}'s engine.
 *
 * Inbound flow:
 *   engine → WhatsAppEventBus('message') → adapter → gate check → onInbound('whatsapp', payload)
 *
 * Outbound flow:
 *   ChannelService.send('whatsapp', msg) → adapter → engine.sendText(chatId, text)
 *
 * Inbound gate (auto-reply policy):
 *   - 'saved_contacts' (default): Only messages from contacts saved in the user's
 *     phone address book are forwarded to the agent. Unknown numbers, business
 *     promotions, and spam are silently dropped — no auto-reply.
 *   - 'allowlist': Only messages from JIDs in `allowedJids` are forwarded.
 *   - 'all': All messages are forwarded (not recommended).
 *   - `blockedJids` always takes precedence (drop regardless of mode).
 *
 * Written from scratch for Agent-X — not copied from any reference project.
 */
import type { OutboundMessage, ChannelStatus, ChannelAttachment } from '../IChannelService.js';
import type { IChannelBridge, OnInboundCallback } from '../IChannelBridge.js';
import type { WhatsAppSessionService } from '../../../whatsapp/WhatsAppSessionService.js';
import type { WhatsAppIncomingMessage } from '../../../whatsapp/engine/IWhatsAppEngine.js';
import { EngineStatus } from '../../../whatsapp/engine/IWhatsAppEngine.js';
import { getLogger } from '@agentx/shared';

export interface WhatsAppBridgeAdapterConfig {
  /** The WhatsAppSessionService that owns the engine + event bus. */
  sessionService: WhatsAppSessionService;
  /**
   * Comma-separated WhatsApp JIDs allowed for inbound. If empty, all senders
   * are allowed (the owner can restrict later via the dashboard). JIDs use the
   * `@c.us` / `@g.us` format from wa-id normalization.
   * @deprecated Use autoReplyMode + allowedJids instead.
   */
  allowedJids?: string[];
  /**
   * Inbound auto-reply policy. Defaults to 'saved_contacts'.
   * See {@link WhatsAppChannelConfig.autoReplyMode} for details.
   */
  autoReplyMode?: 'saved_contacts' | 'allowlist' | 'all';
  /**
   * Explicitly allowed JIDs (supplements saved_contacts mode, or defines
   * the allowlist for 'allowlist' mode).
   */
  extraAllowedJids?: string[];
  /**
   * Explicitly blocked JIDs. Messages from these senders are always dropped.
   */
  blockedJids?: string[];
}

/** Result of the inbound gate check. */
interface GateResult {
  /** Whether the message should be forwarded to the agent. */
  allowed: boolean;
  /** Human-readable reason for the decision (for logging). */
  reason: string;
  /** The sender's saved contact name, if known. */
  contactName?: string;
}

/**
 * Thin IChannelBridge adapter around the WhatsAppSessionService.
 *
 * The adapter does NOT own the session lifecycle — it only reads from the
 * event bus for inbound and delegates to the engine for outbound. The session
 * service's `link()` / `stop()` are called separately by the boot wiring
 * (Phase 5.3).
 */
export class WhatsAppBridgeAdapter implements IChannelBridge {
  private readonly sessionService: WhatsAppSessionService;
  private readonly allowedJids: Set<string>;
  private readonly blockedJids: Set<string>;
  private readonly autoReplyMode: 'saved_contacts' | 'allowlist' | 'all';
  private onInbound: OnInboundCallback | null = null;
  private inboundCount = 0;
  private outboundCount = 0;
  private droppedCount = 0;
  private lastInbound?: string;
  private lastOutbound?: string;
  private lastDropped?: string;
  private messageUnsubscribe: (() => void) | null = null;

  constructor(config: WhatsAppBridgeAdapterConfig) {
    this.sessionService = config.sessionService;
    this.allowedJids = new Set([...(config.allowedJids ?? []), ...(config.extraAllowedJids ?? [])]);
    this.blockedJids = new Set(config.blockedJids ?? []);
    this.autoReplyMode = config.autoReplyMode ?? 'saved_contacts';
  }

  async start(onInbound: OnInboundCallback): Promise<void> {
    this.onInbound = onInbound;

    // Subscribe to inbound messages from the event bus.
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
    this.onInbound = null;
  }

  async send(message: OutboundMessage): Promise<void> {
    const chatId = message.threadId;
    if (!chatId) {
      throw new Error('WhatsApp chat id (threadId) is required to send a message');
    }

    // Get the engine from the session service. The session must be linked.
    const status = await this.sessionService.getStatus();
    if (status.status !== EngineStatus.READY) {
      throw new Error(`WhatsApp session is not ready (current status: ${status.status})`);
    }

    // For now, send text only. Media attachments are handled via the agent
    // tool surface (Phase 6) which has richer send methods.
    const text = this.buildOutboundText(message);
    if (text) {
      // Access the engine through the session service's internal reference.
      // We use a typed cast here because the engine is not exposed publicly
      // on the session service — the adapter is the only consumer that needs
      // direct engine access for outbound sends.
      const engine = (this.sessionService as unknown as { engine: { sendText: (chatId: string, text: string) => Promise<{ messageId: string }> } | null }).engine;
      if (!engine) {
        throw new Error('WhatsApp engine is not available — session may not be linked');
      }
      await engine.sendText(chatId, text);
      this.outboundCount++;
      this.lastOutbound = new Date().toISOString();
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
        droppedCount: this.droppedCount,
        autoReplyMode: this.autoReplyMode,
        lastDropped: this.lastDropped,
      },
    };
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private handleInboundMessage(msg: WhatsAppIncomingMessage): void {
    if (!this.onInbound) return;

    // Skip own messages (echoes from other devices) — the agent only processes
    // messages from other users.
    if (msg.fromMe) return;

    const senderJid = msg.author ?? msg.from;

    // ─── Inbound gate: check if this sender should be processed ───
    const gate = this.checkInboundGate(senderJid, msg.isGroup);
    if (!gate.allowed) {
      this.droppedCount++;
      this.lastDropped = new Date().toISOString();
      getLogger().info('WHATSAPP_BRIDGE', `Inbound message dropped from ${senderJid}: ${gate.reason}`);
      return;
    }

    // Build the text representation for the agent
    const text = this.buildInboundText(msg);
    if (!text) return;

    this.inboundCount++;
    this.lastInbound = new Date().toISOString();

    // Include the sender's saved contact name in the payload so the agent
    // and per-contact session routing can use it.
    const payload = {
      channel: 'whatsapp' as const,
      sender: {
        id: senderJid,
        name: gate.contactName ?? msg.pushName ?? senderJid,
      },
      text,
      threadId: msg.chatId,
      messageId: msg.id,
      raw: msg,
      timestamp: new Date(msg.timestamp * 1000).toISOString(),
    };

    void this.onInbound('whatsapp', payload);
  }

  /**
   * Check the inbound gate — whether a message from this sender should be
   * forwarded to the agent based on the auto-reply policy.
   *
   * Rules (evaluated in order):
   * 1. Group messages: always allowed (groups are opt-in by the user).
   * 2. Blocked JIDs: always dropped.
   * 3. Explicitly allowed JIDs: always allowed (user manually approved).
   * 4. autoReplyMode 'all': allowed.
   * 5. autoReplyMode 'allowlist': dropped (not in allowlist).
   * 6. autoReplyMode 'saved_contacts': check if the sender is in the user's
   *    phone address book via the engine's contact store.
   */
  private checkInboundGate(senderJid: string, isGroup: boolean): GateResult {
    // Groups are always allowed — the user explicitly joined them.
    if (isGroup) {
      return { allowed: true, reason: 'group message' };
    }

    // Blocked JIDs always dropped — check both config and runtime blocklist.
    if (this.blockedJids.has(senderJid) || this.sessionService.isRuntimeBlocked(senderJid)) {
      return { allowed: false, reason: 'sender is blocked' };
    }

    // Explicitly allowed JIDs always pass — check both config and runtime allowlist.
    if (this.allowedJids.has(senderJid) || this.sessionService.isRuntimeAllowed(senderJid)) {
      return { allowed: true, reason: 'sender is explicitly allowed' };
    }

    if (this.autoReplyMode === 'all') {
      return { allowed: true, reason: 'autoReplyMode is all' };
    }

    if (this.autoReplyMode === 'allowlist') {
      return { allowed: false, reason: 'autoReplyMode is allowlist and sender not in list' };
    }

    // autoReplyMode === 'saved_contacts' — check the engine's contact store.
    const engine = this.sessionService.getEngine();
    if (!engine?.isSavedContact) {
      // Engine not ready or doesn't support contact lookup — fail safe (drop).
      return { allowed: false, reason: 'engine not ready or isSavedContact not supported' };
    }

    const contact = engine.isSavedContact(senderJid);
    if (contact.saved) {
      return { allowed: true, reason: 'sender is a saved contact', contactName: contact.name };
    }

    return { allowed: false, reason: 'sender is not a saved contact (unknown number or business)' };
  }

  /**
   * Build the text representation of an inbound WhatsApp message for the agent.
   * Non-text message types are prefixed with a type indicator so the agent
   * knows what kind of message it was.
   */
  private buildInboundText(msg: WhatsAppIncomingMessage): string {
    switch (msg.type) {
      case 'text':
        return msg.body;
      case 'image':
      case 'video':
      case 'audio':
      case 'voice':
      case 'document':
      case 'sticker': {
        const caption = msg.media?.caption ?? msg.body ?? '';
        const mediaNote = `[${msg.type}${msg.media?.omitted ? ' (media omitted — too large)' : ''}]`;
        return caption ? `${mediaNote} ${caption}` : mediaNote;
      }
      case 'location': {
        if (msg.location) {
          const name = msg.location.name ? ` (${msg.location.name})` : '';
          return `[location] ${msg.location.latitude},${msg.location.longitude}${name}`;
        }
        return '[location]';
      }
      case 'contact':
        return msg.body || '[contact card]';
      case 'poll':
        return msg.body || '[poll]';
      case 'call':
        return msg.body || '[call notification]';
      case 'revoked':
        return '[message revoked]';
      case 'unknown':
      default:
        // Still deliver the body if there is one — some "unknown" types carry text
        return msg.body || `[unknown message type: ${msg.type}]`;
    }
  }

  /**
   * Build the outbound text from an `OutboundMessage`. Attachments are noted
   * but not sent as media (the agent tool surface in Phase 6 handles rich
   * media sends).
   */
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
