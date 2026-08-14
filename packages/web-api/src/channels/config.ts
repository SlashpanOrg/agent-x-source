import {
  DiscordBridge,
  DiscordBridgeAdapter,
  SlackBridge,
  SlackBridgeAdapter,
  EmailBridge,
  EmailBridgeAdapter,
  ChannelService,
  WhatsAppSessionService,
  WhatsAppBridgeAdapter,
  StandingOrderStore,
  WhatsAppJarvisRouter,
  ContactDirectoryStore,
  setWhatsAppSessionServiceInstance,
  setStandingOrderStoreInstance,
  setContactDirectoryStoreInstance,
} from '@agentx/engine';
import type { AgentXConfig } from '@agentx/shared';
import { parseAllowedUserIds } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { getEngine } from '../engine.js';
import { channelEnabled, wantsInbound, resolveTelegramBotToken, telegramRuntime } from './shared.js';
import { isTelegramInboundReady, persistTelegramSettings, startTelegramInbound, stopTelegramInbound } from './telegram.js';
import { createWhatsAppJarvisHooks } from '../whatsapp-jarvis-hooks.js';

/** Start/stop inbound bridges from Settings → Channels config. */
export async function applyChannelsConfig(cfg?: AgentXConfig): Promise<void> {
  const eng = getEngine();
  const config = cfg ?? eng.configManager.load();
  const ch = config.channels;

  // Telegram
  const telegramToken = resolveTelegramBotToken(ch?.telegram);
  // Backfill owner allowlist from private chat id when older configs only saved chatId.
  if (
    ch?.telegram?.chatId
    && !parseAllowedUserIds(ch.telegram.allowedUserIds).length
    && !String(ch.telegram.chatId).startsWith('-')
  ) {
    const backfilled = persistTelegramSettings({
      allowedUserIds: String(ch.telegram.chatId).trim(),
    });
    ch.telegram = backfilled.channels?.telegram;
  }
  if (isTelegramInboundReady(ch?.telegram) && telegramToken) {
    try {
      telegramRuntime.lastStartError = null;
      await startTelegramInbound(telegramToken);
    } catch (e) {
      telegramRuntime.lastStartError = e instanceof Error ? e.message : String(e);
      getLogger().warn('CHANNELS', `Telegram inbound start failed: ${telegramRuntime.lastStartError}`);
    }
  } else if (!channelEnabled(ch?.telegram)) {
    await stopTelegramInbound();
  } else if (ch?.telegram?.enabled && !telegramToken) {
    telegramRuntime.lastStartError = 'Bot token missing from saved config — re-verify in Settings → Channels';
    getLogger().warn('CHANNELS', telegramRuntime.lastStartError);
  }

  // Discord/Slack/Email/WhatsApp are now routed through the unified ChannelService.
  const channelService = eng.serviceContext?.channelService as ChannelService | undefined;
  if (channelService) {
    await channelService.stop();

    // Stop any existing WhatsApp session before re-evaluating config
    if (eng.whatsappSessionService) {
      try { await eng.whatsappSessionService.stop(); } catch { /* best-effort */ }
      eng.whatsappSessionService = null;
      setWhatsAppSessionServiceInstance(null);
      setStandingOrderStoreInstance(null);
      setContactDirectoryStoreInstance(null);
    }

    // Discord inbound (bot)
    const discord = ch?.discord;
    const discordAllowed = parseAllowedUserIds(discord?.allowedUserIds);
    if (wantsInbound(discord) && discord?.botToken) {
      try {
        const bridge = new DiscordBridge();
        const adapter = new DiscordBridgeAdapter({
          bridge,
          discordConfig: { botToken: discord.botToken, channelId: discord.channelId },
          allowedUserIds: discordAllowed,
        });
        channelService.registerBridge('discord', adapter);
        eng.discordBridge = bridge;
      } catch (e) {
        getLogger().warn('CHANNELS', `Discord inbound start failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Slack inbound (Socket Mode)
    const slack = ch?.slack;
    const slackAllowed = parseAllowedUserIds(slack?.allowedUserIds);
    if (wantsInbound(slack) && slack?.botToken && slack?.appToken) {
      try {
        const bridge = new SlackBridge({ botToken: slack.botToken, appToken: slack.appToken });
        const adapter = new SlackBridgeAdapter({
          bridge,
          slackConfig: { botToken: slack.botToken, appToken: slack.appToken },
          allowedUserIds: slackAllowed,
        });
        channelService.registerBridge('slack', adapter);
        eng.slackBridge = bridge;
      } catch (e) {
        getLogger().warn('CHANNELS', `Slack inbound start failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Email inbound/outbound
    const email = ch?.email;
    if (wantsInbound(email) && email?.smtpHost && email?.smtpUser && email?.smtpPassword) {
      try {
        const bridge = new EmailBridge();
        const adapter = new EmailBridgeAdapter({
          bridge,
          emailConfig: {
            smtpHost: email.smtpHost,
            smtpPort: email.smtpPort ?? 587,
            smtpUser: email.smtpUser,
            smtpPass: email.smtpPassword,
            fromAddress: email.fromAddress ?? email.smtpUser,
          },
        });
        channelService.registerBridge('email', adapter);
        eng.emailBridge = bridge;
      } catch (e) {
        getLogger().warn('CHANNELS', `Email inbound start failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // WhatsApp inbound/outbound (single session, QR/pairing-code linking)
    // Auto-pause: on startup, we always create the session service and attempt
    // to connect. If the connection fails (protocol break, library
    // incompatibility, etc.), the service enters a paused state. The UI shows
    // a retry button so the user can manually try again.
    const whatsapp = ch?.whatsapp;
    if (wantsInbound(whatsapp) && eng.pgPool && eng.dek) {
      const sessionService = new WhatsAppSessionService({
        pool: eng.pgPool,
        dek: eng.dek,
        engine: whatsapp?.engine ?? 'baileys',
      });
      try {
        // Boot-time reconciliation: if a completed QR link is stored, reconnect
        // silently (WhatsApp Web behaviour). First-time setup does not start a
        // QR here — the owner clicks Connect when they are ready to scan.
        await sessionService.reconcileOnBoot();
      } catch (e) {
        getLogger().warn('CHANNELS', `WhatsApp startup failed: ${e instanceof Error ? e.message : String(e)} — entering paused state`);
        sessionService.paused = true;
      }
      // Always register the bridge and store the service, even if paused —
      // the bridge and tool helpers check the paused flag at runtime.
      const standingOrders = new StandingOrderStore(eng.pgPool);
      setStandingOrderStoreInstance(standingOrders);
      const contactDirectory = new ContactDirectoryStore(eng.pgPool);
      setContactDirectoryStoreInstance(contactDirectory);
      sessionService.setContactDirectory(contactDirectory);
      void contactDirectory.load();
      const jarvisRouter = new WhatsAppJarvisRouter({
        sessionService,
        standingOrders,
        contactDirectory,
        ...createWhatsAppJarvisHooks(),
      });
      const adapter = new WhatsAppBridgeAdapter({
        sessionService,
        jarvisRouter,
      });
      channelService.registerBridge('whatsapp', adapter);
      eng.whatsappSessionService = sessionService;
      setWhatsAppSessionServiceInstance(sessionService);
    }

    await channelService.start();
  }

  try {
    const { propagateTelegramConnectedToAgents, pruneChannelCoveredMcpConnections } = await import('../channel-session-bridge.js');
    propagateTelegramConnectedToAgents(eng);
    await pruneChannelCoveredMcpConnections(eng);
  } catch { /* best-effort */ }
}
