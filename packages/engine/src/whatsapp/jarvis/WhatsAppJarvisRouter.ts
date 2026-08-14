import { getLogger, type EngineEvent } from '@agentx/shared';
import type { Agent } from '../../agent/Agent.js';
import { sendViaSessionConnection } from '../../session-connection/channel-send.js';
import { toNeutralJid } from '../identity/wa-id.js';
import type { WhatsAppIncomingMessage } from '../engine/IWhatsAppEngine.js';
import type { WhatsAppSessionService } from '../WhatsAppSessionService.js';
import { classifyWhatsAppInbound } from './classifyInbound.js';
import {
  AGENT_X_WHATSAPP_MARKER,
  formatAgentSelfChat,
  VOICE_ANNOUNCE_DEBOUNCE_MS,
  WORLD_BRIEF_COALESCE_MS,
} from './constants.js';
import { formatInboundText } from './formatInbound.js';
import { matchStandingOrder } from './matchStandingOrder.js';
import type { StandingOrderStore } from './StandingOrderStore.js';
import type { ContactDirectoryStore } from '../contacts/ContactDirectoryStore.js';
import { contactDisplayName } from '../contacts/normalize.js';
import {
  WHATSAPP_TYPING_REFRESH_MS,
  WhatsAppSelfChatProgress,
  chunkWhatsAppText,
  isStopCommand,
  ownerCallsign,
  parsePermissionReply,
  parseStepCapReply,
} from './self-chat-progress.js';

function extractAssistantText(response: unknown): string {
  if (!response || typeof response !== 'object') return '';
  const rec = response as { content?: unknown; parts?: Array<{ type?: string; content?: string }> };
  if (typeof rec.content === 'string' && rec.content.trim()) return rec.content.trim();
  if (Array.isArray(rec.parts)) {
    return rec.parts
      .filter((p) => p?.type === 'text' && typeof p.content === 'string')
      .map((p) => p.content!.trim())
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

export interface JarvisNotificationInput {
  title: string;
  body: string;
  payload?: Record<string, unknown>;
}

export interface WhatsAppJarvisRouterHooks {
  ensureOwnerAgent: () => Agent | null | Promise<Agent | null>;
  publishNotification?: (input: JarvisNotificationInput) => Promise<void>;
  announceVoice?: (line: string, context?: string) => Promise<void>;
}

export interface WhatsAppJarvisRouterOptions extends WhatsAppJarvisRouterHooks {
  sessionService: WhatsAppSessionService;
  standingOrders: StandingOrderStore;
  contactDirectory?: ContactDirectoryStore | null;
}

interface ActiveOwnerTurn {
  agent: Agent;
  chatId: string;
  messageId: string;
  progress: WhatsAppSelfChatProgress;
}

export class WhatsAppJarvisRouter {
  private readonly sessionService: WhatsAppSessionService;
  private readonly standingOrders: StandingOrderStore;
  private readonly contactDirectory: ContactDirectoryStore | null;
  private readonly hooks: WhatsAppJarvisRouterHooks;
  private readonly lastWorldBriefAt = new Map<string, number>();
  private readonly lastVoiceAnnounceAt = new Map<string, number>();
  private handling = false;
  private readonly pending: WhatsAppIncomingMessage[] = [];
  private activeOwner: ActiveOwnerTurn | null = null;

  constructor(options: WhatsAppJarvisRouterOptions) {
    this.sessionService = options.sessionService;
    this.standingOrders = options.standingOrders;
    this.contactDirectory = options.contactDirectory ?? null;
    this.hooks = options;
  }

  async handleIncoming(msg: WhatsAppIncomingMessage): Promise<void> {
    if (this.activeOwner) {
      const text = formatInboundText(msg);
      const classified = classifyWhatsAppInbound({ ...msg, body: text }, {
        ownerJids: this.sessionService.getOwnerJids(),
        recentOutboundIds: this.sessionService.getRecentOutboundIds(),
      });
      if (classified.kind === 'owner_command') {
        const consumed = await this.handleOwnerFollowup(classified.text, classified.chatId, classified.messageId);
        if (consumed) return;
        await this.sendSelfChat(
          formatAgentSelfChat("Still working on the last one — I'll take this next."),
          classified.chatId,
        ).catch(() => {});
        this.pending.push(msg);
        return;
      }
    }

    this.pending.push(msg);
    if (this.handling) return;
    this.handling = true;
    try {
      while (this.pending.length > 0) {
        const next = this.pending.shift()!;
        try {
          await this.dispatch(next);
        } catch (err) {
          getLogger().warn(
            'WHATSAPP_JARVIS',
            `Inbound dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } finally {
      this.handling = false;
    }
  }

  private async dispatch(raw: WhatsAppIncomingMessage): Promise<void> {
    const text = formatInboundText(raw);
    const msg = { ...raw, body: text };
    const classified = classifyWhatsAppInbound(msg, {
      ownerJids: this.sessionService.getOwnerJids(),
      recentOutboundIds: this.sessionService.getRecentOutboundIds(),
    });

    if (classified.kind === 'ignore') {
      getLogger().info('WHATSAPP_JARVIS', `Dropped inbound: ${classified.reason}`);
      return;
    }

    if (classified.kind === 'owner_command') {
      await this.handleOwnerCommand(classified.text, classified.chatId, classified.messageId);
      return;
    }

    await this.handleWorld({
      ...classified,
      attachmentId: msg.attachmentId,
      mediaMime: msg.media?.mimetype,
      mediaCaption: msg.media?.caption,
      mediaOmitted: Boolean(msg.media && !msg.attachmentId),
    });
  }

  private async handleOwnerFollowup(text: string, chatId: string, messageId: string): Promise<boolean> {
    const turn = this.activeOwner;
    if (!turn) return false;
    const agent = turn.agent;
    await this.reactToOwner(chatId, messageId, '👀');

    if (isStopCommand(text) && typeof agent.cancel === 'function') {
      agent.cancel();
      await this.sendSelfChat(formatAgentSelfChat('Stopped.'), turn.chatId).catch(() => {});
      return true;
    }

    if (turn.progress.pendingPermission) {
      const choice = parsePermissionReply(text);
      const requestId = turn.progress.pendingPermission.requestId;
      if (choice) {
        agent.respondToPermission?.(requestId, choice);
        turn.progress.pendingPermission = null;
        const ack = choice === 'deny' ? 'Denied — skipping that.' : choice === 'allow_always' ? 'Always allowed. Continuing.' : 'Approved. Continuing.';
        await this.sendSelfChat(formatAgentSelfChat(ack), turn.chatId).catch(() => {});
        return true;
      }
      if (typeof agent.respondToPermissionInstruction === 'function') {
        agent.respondToPermissionInstruction(requestId, text);
        turn.progress.pendingPermission = null;
        await this.sendSelfChat(formatAgentSelfChat('Got it — continuing.'), turn.chatId).catch(() => {});
        return true;
      }
    }

    if (turn.progress.awaitingStepCap) {
      const cont = parseStepCapReply(text);
      if (cont != null && typeof agent.respondToStepCap === 'function') {
        agent.respondToStepCap(cont);
        turn.progress.awaitingStepCap = false;
        await this.sendSelfChat(
          formatAgentSelfChat(cont ? 'Continuing.' : 'Stopping here.'),
          turn.chatId,
        ).catch(() => {});
        return true;
      }
    }

    if (turn.progress.awaitingClarification || agent.isAwaitingClarification?.()) {
      const delivered = agent.respondToClarification?.(text) === true;
      if (delivered) {
        turn.progress.awaitingClarification = false;
        await this.sendSelfChat(formatAgentSelfChat('Got it — continuing.'), turn.chatId).catch(() => {});
        return true;
      }
    }

    return false;
  }

  private async handleOwnerCommand(text: string, chatId: string, messageId: string): Promise<void> {
    if (this.activeOwner) {
      const consumed = await this.handleOwnerFollowup(text, chatId, messageId);
      if (consumed) return;
      await this.sendSelfChat(
        formatAgentSelfChat("Still working on the last one — I'll take this next."),
        chatId,
      ).catch(() => {});
      return;
    }

    const agent = await this.hooks.ensureOwnerAgent();
    if (!agent || typeof (agent as { sendMessage?: unknown }).sendMessage !== 'function') {
      getLogger().warn('WHATSAPP_JARVIS', 'No owner agent for self-chat command');
      return;
    }

    const progress = new WhatsAppSelfChatProgress({
      callsign: ownerCallsign(agent.config?.user?.callsign),
      send: (line) => this.sendSelfChat(formatAgentSelfChat(line), chatId, messageId),
    });
    this.activeOwner = { agent, chatId, messageId, progress };

    let unsub: (() => void) | undefined;
    let typingTimer: ReturnType<typeof setInterval> | undefined;
    const stopTyping = () => {
      if (typingTimer) {
        clearInterval(typingTimer);
        typingTimer = undefined;
      }
      void this.setTyping(chatId, false);
    };

    try {
      await this.reactToOwner(chatId, messageId, '👀');
      await this.setTyping(chatId, true);
      typingTimer = setInterval(() => {
        void this.setTyping(chatId, true);
      }, WHATSAPP_TYPING_REFRESH_MS);

      await progress.start();

      const events = agent.events;
      if (events && typeof events.on === 'function') {
        unsub = events.on((ev: EngineEvent) => {
          progress.handleEngineEvent(ev);
        });
      }

      const response = await sendViaSessionConnection(agent, text, {
        channelId: chatId,
        userId: chatId,
        sourceChannel: 'whatsapp',
        sourceMessageId: messageId,
      });
      await progress.flush();
      const content = extractAssistantText(response);
      if (!content) {
        getLogger().warn('WHATSAPP_JARVIS', 'Owner agent returned an empty self-chat reply');
        await this.sendSelfChat(formatAgentSelfChat(
          'I processed that but have no text reply yet. If I asked a follow-up, answer it here.',
        ), chatId, messageId);
        await this.reactToOwner(chatId, messageId, '✅');
        return;
      }
      for (const chunk of chunkWhatsAppText(content)) {
        await this.sendSelfChat(formatAgentSelfChat(chunk), chatId, messageId);
      }
      await this.reactToOwner(chatId, messageId, '✅');
    } catch (err) {
      const cancelled = agent.isUserCancelled?.() === true
        || (err instanceof Error && (err.name === 'AbortError' || /abort|cancel/i.test(err.message)));
      if (cancelled) {
        await this.reactToOwner(chatId, messageId, '🛑');
        return;
      }
      const detail = err instanceof Error ? err.message : String(err);
      getLogger().warn('WHATSAPP_JARVIS', `Self-chat agent turn failed: ${detail}`);
      await progress.flush().catch(() => {});
      await this.sendSelfChat(formatAgentSelfChat(`I hit an error processing that: ${detail}`), chatId, messageId).catch(() => {});
      await this.reactToOwner(chatId, messageId, '⚠️');
    } finally {
      unsub?.();
      progress.stop();
      stopTyping();
      this.activeOwner = null;
    }
  }

  private async handleWorld(event: {
    senderJid: string;
    chatId: string;
    text: string;
    isGroup: boolean;
    senderName?: string;
    messageId: string;
    attachmentId?: string;
    mediaMime?: string;
    mediaCaption?: string;
    mediaOmitted?: boolean;
  }): Promise<void> {
    const orders = await this.standingOrders.list(true).catch(() => []);
    const matched = matchStandingOrder(orders, event);
    const action = matched?.action.type ?? 'brief';
    const indexed = this.contactDirectory?.getByJid(event.senderJid);
    const who = (indexed ? contactDisplayName(indexed) : event.senderName?.trim()) || event.senderJid;
    void this.contactDirectory?.observeInbound(event.senderJid, event.senderName);
    const preview = event.text.length > 280 ? `${event.text.slice(0, 277)}…` : event.text;

    if (action === 'ignore') {
      getLogger().info('WHATSAPP_JARVIS', `Standing order ignored world message from ${who}`);
      return;
    }

    if (action === 'auto_reply' && matched?.action.replyTemplate?.trim()) {
      await this.sendAsOwner(event.chatId, matched.action.replyTemplate.trim());
    }

    const now = Date.now();
    const lastBrief = this.lastWorldBriefAt.get(event.senderJid) ?? 0;
    const coalesced = now - lastBrief < WORLD_BRIEF_COALESCE_MS;
    this.lastWorldBriefAt.set(event.senderJid, now);

    const briefLines = [
      AGENT_X_WHATSAPP_MARKER,
      action === 'auto_reply' && matched
        ? `I replied to ${who} per standing order "${matched.title}".`
        : `Message from ${who}${event.isGroup ? ' in a group' : ''}: "${preview}"`,
      action === 'auto_reply'
        ? 'Say if you want a different reply next time, or revoke that standing order.'
        : 'Say "tell them …" to reply as you, or set a standing order if you want this handled next time.',
    ];
    await this.sendSelfChat(briefLines.join('\n'));

    if (coalesced) return;

    const title = event.isGroup ? `WhatsApp group · ${who}` : `WhatsApp · ${who}`;
    const body = action === 'auto_reply' && matched
      ? `Replied per "${matched.title}": ${preview}`
      : preview;
    await this.hooks.publishNotification?.({
      title,
      body,
      payload: {
        senderJid: event.senderJid,
        chatId: event.chatId,
        messageId: event.messageId,
        standingOrderId: matched?.id,
      },
    }).catch((err) => {
      getLogger().warn('WHATSAPP_JARVIS', `Notification failed: ${err instanceof Error ? err.message : String(err)}`);
    });

    const announceVoice = matched?.action.announceVoice !== false;
    const lastVoice = this.lastVoiceAnnounceAt.get(event.senderJid) ?? 0;
    if (announceVoice && now - lastVoice >= VOICE_ANNOUNCE_DEBOUNCE_MS) {
      this.lastVoiceAnnounceAt.set(event.senderJid, now);
      const spokenName = who.includes('@') ? (event.senderName?.trim() || 'someone') : who;
      const line = `Sir, there is a message from ${spokenName}. Would you like me to read that?`;
      const context = [
        '[WHATSAPP_PENDING_BRIEF]',
        `Sender: ${who}`,
        `JID: ${event.senderJid}`,
        `Chat: ${event.chatId}`,
        `Group: ${event.isGroup ? 'yes' : 'no'}`,
        `Text: ${event.text}`,
        ...(event.attachmentId ? [
          `Media-Storage-Id: ${event.attachmentId}`,
          `Media-Kind: ${event.mediaMime?.startsWith('video/') ? 'video' : event.mediaMime?.startsWith('image/') ? 'image' : 'document'}`,
          `Media-Mime: ${event.mediaMime ?? ''}`,
          `Media-Caption: ${event.mediaCaption ?? event.text}`,
          `Media-Title: Message from ${who}`,
        ] : event.mediaOmitted ? [
          'Media-Omitted: yes (over 10MB or unsupported type — could not store it for the visual stage)',
        ] : []),
        'The owner was just told about this WhatsApp message over voice.',
        'If they say yes / read it / what did they say — read the message aloud.',
        'If they ask to reply, send as them with whatsapp_send_text (use their wording).',
        'If they ask for an emoji or reaction, use whatsapp_react or send the emoji as them.',
        'If they ask to ignore, archive, or set a standing order, do that.',
        '[/WHATSAPP_PENDING_BRIEF]',
      ].join('\n');
      await this.hooks.announceVoice?.(line, context).catch((err) => {
        getLogger().warn('WHATSAPP_JARVIS', `Voice announce failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  private async sendSelfChat(
    text: string,
    chatId = this.sessionService.getSelfChatId(),
    quotedMessageId?: string,
  ): Promise<void> {
    const target = chatId || this.sessionService.getSelfChatId();
    if (!target) {
      getLogger().warn('WHATSAPP_JARVIS', 'Cannot brief owner — linked phone / self-chat id unknown');
      return;
    }
    this.sessionService.rememberSelfChatId(target);
    await this.sendAsOwner(target, text, true, quotedMessageId);
  }

  private async sendAsOwner(
    chatId: string,
    text: string,
    rememberEcho = false,
    quotedMessageId?: string,
  ): Promise<void> {
    const engine = this.sessionService.getEngine();
    if (!engine) {
      throw new Error('WhatsApp engine is not available');
    }
    const sent = await engine.sendText(toNeutralJid(chatId), text, quotedMessageId
      ? { quotedMessageId, quotedFromMe: true }
      : undefined);
    getLogger().info(
      'WHATSAPP_JARVIS',
      `Sent ${rememberEcho ? 'self-chat' : 'outbound'} to ${toNeutralJid(chatId)} id=${sent?.messageId ?? '?'}`,
    );
    if (rememberEcho && sent?.messageId) {
      this.sessionService.rememberOutboundId(sent.messageId);
    }
  }

  private async setTyping(chatId: string, typing: boolean): Promise<void> {
    const engine = this.sessionService.getEngine();
    if (!engine?.setTyping) return;
    await engine.setTyping(toNeutralJid(chatId), typing).catch(() => {});
  }

  private async reactToOwner(chatId: string, messageId: string, emoji: string): Promise<void> {
    const engine = this.sessionService.getEngine();
    if (!engine || typeof engine.react !== 'function') return;
    await engine.react(toNeutralJid(chatId), messageId, emoji, { fromMe: true }).catch(() => {});
  }
}
