import type { AgentXConfig } from '@agentx/shared';
import { isMessagingChannel } from '@agentx/shared';
import { registerChannelPermissionBridge } from '../../channels/channel-permission-bridge.js';
import { createAiSdkModel } from '../../agent/AiSdkBridge.js';
import { withSpan } from '../../observability/tracer.js';
import { streamText } from 'ai';
import type { ToolExecutor } from '../../tools/ToolExecutor.js';
import type { PermissionManager } from '../../tools/permissions/PermissionManager.js';

export interface ChannelOrchestratorHost {
  readonly sessionId: string;
  readonly options: { channelSession?: boolean };
  readonly config: AgentXConfig;
  getToolExecutor(): ToolExecutor | undefined;
  getPermissionManager(): PermissionManager | undefined;
  getApiKey(): string | undefined;
  removeStorePermissions(toolName?: string): void;
  rebuildSystemPrompt(): void;
}

export class ChannelOrchestrator {
  private _telegramConnected = false;
  private _telegramChatId: number | null = null;
  private activeInboundChannel: string | null = null;

  constructor(private readonly host: ChannelOrchestratorHost) {}

  setTelegramConnected(connected: boolean, chatId?: number | null): void {
    this._telegramConnected = connected;
    this._telegramChatId = chatId ?? this._telegramChatId;
    this.host.rebuildSystemPrompt();
  }

  getTelegramConnected(): boolean {
    return this._telegramConnected;
  }

  getActiveInboundChannel(): string | null {
    return this.activeInboundChannel;
  }

  isMessagingChannelContext(): boolean {
    if (this.host.options.channelSession) return true;
    return isMessagingChannel(this.activeInboundChannel);
  }

  beginChannelTurn(sourceChannel?: string): boolean {
    const messaging = isMessagingChannel(sourceChannel);
    this.activeInboundChannel = messaging ? (sourceChannel ?? null) : null;
    const executor = this.host.getToolExecutor();
    if (executor) {
      executor.setMessagingPermissionMode(messaging);
      executor.setInboundSourceChannel(this.activeInboundChannel);
    }
    return messaging;
  }

  endChannelTurn(): void {
    this.activeInboundChannel = null;
    const executor = this.host.getToolExecutor();
    if (executor) {
      executor.setMessagingPermissionMode(false);
      executor.setInboundSourceChannel(null);
    }
  }

  registerPermissionBridge(): void {
    registerChannelPermissionBridge(this.host.sessionId, {
      list: () => this.formatChannelToolPermissions(),
      revoke: (tools, revokeAll) => this.revokeChannelToolPermissions(tools, revokeAll),
    });
  }

  formatChannelToolPermissions(): string {
    const pm = this.host.getPermissionManager();
    if (!pm) return '🔐 No permission state available.';
    if (pm.isAllAllowed()) {
      return '🔐 *Permissions*\n✅ All tools are always allowed for this channel session.';
    }
    const perms = pm.list().filter((p) => p.id !== '__all__');
    const allowed = perms.filter((p) => p.decision === 'allow_always').map((p) => p.toolName);
    const denied = perms.filter((p) => p.decision === 'deny').map((p) => p.toolName);
    const lines = ['🔐 *Permissions*'];
    lines.push('', '*Always allowed:*', allowed.length ? allowed.map((t) => `  ✅ ${t}`).join('\n') : '  (none)');
    lines.push('', '*Denied:*', denied.length ? denied.map((t) => `  ❌ ${t}`).join('\n') : '  (none)');
    lines.push('', 'Revoke with `/permissions revoke <tool>` or `/permissions revoke-all`.');
    return lines.join('\n');
  }

  revokeChannelToolPermissions(tools?: string[], revokeAll = false): string {
    const pm = this.host.getPermissionManager();
    if (!pm) return '🔐 No permission state available.';
    if (revokeAll) {
      pm.revokeAll();
      this.host.removeStorePermissions();
      return '🗑 All remembered tool permissions revoked for this channel session.';
    }
    const names = (tools ?? []).map((t) => t.trim()).filter(Boolean);
    if (!names.length) return '❌ Specify at least one tool name to revoke.';
    for (const name of names) {
      pm.revoke(name);
      this.host.removeStorePermissions(name);
    }
    return `🗑 Revoked permissions for: ${names.join(', ')}`;
  }

  async generateOutboundText(
    userPrompt: string,
    options?: { systemHint?: string; maxTokens?: number },
  ): Promise<string> {
    const model = createAiSdkModel(this.host.config, this.host.getApiKey());
    const callsign = this.host.config.user?.callsign;
    const defaultSystem = [
      'You are Agent-X composing a short outbound Telegram message.',
      callsign ? `If this message is to the owner, address them by callsign "${callsign}" — not a public honorific.` : '',
      'Reply with ONLY the message body — warm, concise, no markdown headers, no tool names, no meta commentary.',
    ].filter(Boolean).join(' ');
    const messages = [
      { role: 'system' as const, content: options?.systemHint ?? defaultSystem },
      { role: 'user' as const, content: userPrompt },
    ];
    const trimmed = await withSpan('llm.outbound', 'llm', async (span) => {
      span.setAttribute('gen_ai.system', this.host.config.provider.activeProvider);
      span.setAttribute('gen_ai.request.model', this.host.config.provider.activeModel);
      span.setAttribute('gen_ai.usage.total_cost', 0);
      span.setAttribute('llm.input_messages', JSON.stringify(messages));
      const r = await streamText({
        model,
        messages,
        maxOutputTokens: options?.maxTokens ?? 280,
      });
      let text = '';
      for await (const chunk of r.textStream) text += chunk;
      const content = text.trim();
      span.setAttribute('llm.output_messages', JSON.stringify([{ role: 'assistant', content }]));
      return content;
    });
    if (!trimmed) throw new Error('Model returned an empty message');
    return trimmed;
  }
}
