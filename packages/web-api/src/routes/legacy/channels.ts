/**
 * Channels route group (Telegram / Discord / Slack / Email bridges).
 *
 * Extracted from legacy.ts. Registers handlers on a dedicated Router and
 * exports createChannelsRouter() for mounting by the legacy aggregator.
 */
import { Router } from 'express';
import { getLogger } from '@agentx/shared';
import type { ProviderId } from '@agentx/shared';
import { channelSessionIdForBinding, type ChannelBindingId } from '@agentx/shared';
import { getActiveTelegramBridge } from '@agentx/engine';
import { getEngine, ensureChannelAgent } from '../../engine.js';
import {
  discoverTelegramBot,
  getTelegramInboundStatus,
  getTelegramRuntimeHints,
  restartTelegramInbound,
  saveVerifiedTelegram,
  sendTelegramGreeting,
} from '../../channels-sync.js';
import { DiscordBridge, DiscordStore, SlackBridge, SlackStore, EmailBridge, Agent } from '@agentx/engine';
import type { WhatsAppSessionStatus } from '@agentx/engine';

export function createChannelsRouter(): Router {
  const r = Router();

  r.post('/api/channels/telegram/discover', async (req, res) => {
    try {
      const { botToken, chatId: hintChatId } = req.body as { botToken?: string; chatId?: string };
      if (!botToken?.trim()) {
        res.status(400).json({ ok: false, error: 'botToken is required' });
        return;
      }
      const savedChatId = getEngine().configManager.load().channels?.telegram?.chatId?.trim();
      const runtimeChatId = getTelegramRuntimeHints().telegramChatId?.trim();
      const result = await discoverTelegramBot(botToken, {
        knownChatIds: [
          hintChatId,
          savedChatId,
          runtimeChatId ?? undefined,
        ].filter((id): id is string => Boolean(id?.trim())),
      });
      if (!result.ok) {
        res.status(400).json(result);
        return;
      }
      if (result.chats?.length) {
        const privateChat = result.chats.find((c) => c.type === 'private') ?? result.chats[0]!;
        const chatId = privateChat.id;
        const allowedUserId = result.allowedUserId
          ?? privateChat.userId
          ?? (privateChat.type === 'private' ? privateChat.id : undefined);
        if (!allowedUserId) {
          res.json({
            ok: true,
            botUsername: result.botUsername,
            botName: result.botName,
            chats: result.chats,
            error: 'Message your bot in a private Telegram chat (not a group), then verify again.',
          });
          return;
        }
        const saved = await saveVerifiedTelegram(botToken, chatId, allowedUserId);
        res.json({ ...result, ...saved, chatId, allowedUserId, saved: true });
        return;
      }
      res.json(result);
    } catch (e: unknown) {
      getLogger().error('POST_CHANNELS_TELEGRAM_DISCOVER', e instanceof Error ? e : String(e));
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'discover-failed' });
    }
  });

  r.post('/api/channels/telegram/greeting', async (req, res) => {
    try {
      const { botToken, chatId } = req.body as { botToken?: string; chatId?: string };
      const result = await sendTelegramGreeting({ botToken, chatId });
      if (!result.ok) {
        res.status(400).json(result);
        return;
      }
      res.json(result);
    } catch (e: unknown) {
      getLogger().error('POST_CHANNELS_TELEGRAM_GREETING', e instanceof Error ? e : String(e));
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'greeting-failed' });
    }
  });

  r.get('/api/channels/telegram/status', async (_req, res) => {
    try {
      const status = getTelegramInboundStatus();
      if (status.inboundReady && !status.bridgeRunning) {
        const restarted = await restartTelegramInbound();
        res.json({ ok: true, ...restarted.status, selfHealAttempted: true, selfHealOk: restarted.ok, selfHealError: restarted.error });
        return;
      }
      res.json({ ok: true, ...status });
    } catch (e: unknown) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'status-failed' });
    }
  });

  r.post('/api/channels/telegram/restart', async (_req, res) => {
    try {
      const result = await restartTelegramInbound();
      if (!result.ok) {
        res.status(400).json(result);
        return;
      }
      res.json(result);
    } catch (e: unknown) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'restart-failed' });
    }
  });

  r.post('/api/telegram/start', async (req, res) => {
    try {
      const { token } = req.body as { token: string };
      const eng = getEngine();
      const existing = eng.pluginRegistry.getPlugin('telegram');
      if (existing) {
        eng.pluginRegistry.updateConfig('telegram', { botToken: token });
      } else {
        const { getBuiltinPlugin } = await import('@agentx/engine');
        const entry = getBuiltinPlugin('telegram');
        if (entry) {
          eng.pluginRegistry.install(entry);
          eng.pluginRegistry.updateConfig('telegram', { botToken: token });
        }
      }
      // Auto-enable the plugin
      eng.pluginRegistry.enable('telegram');
      // Start Telegram bridge immediately if not already running
      if (!eng.telegramBridge && !process.env['AGENTX_DAEMON_HANDLES_TG']) {
        // If gateway exists but bridge is dead, clean up stale state
        if (eng.gateway) {
          try { eng.gateway.stopChannel('telegram'); } catch (e) { /* ignore */ }
          eng.gateway = null;
        }
        const { Gateway } = await import('@agentx/engine');
        eng.gateway = new Gateway();
        try {
          const tgPlugin = eng.gateway.registerTelegram(token);
          tgPlugin.setAgent(ensureChannelAgent('telegram'));
          await eng.gateway.startChannel('telegram');
          eng.telegramBridge = eng.gateway.getTelegramBridge();
          res.json({ ok: true, message: 'Telegram bot started and listening.' });
          return;
        } catch (e) {
          res.json({ ok: true, message: 'Token saved but bridge start failed. Will retry on next session.' });
          return;
        }
      }
      res.json({ ok: true, message: 'Token saved. Telegram plugin configured and enabled.' });
    } catch (e: unknown) {
      getLogger().error('POST_API_TELEGRAM_START', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'save-failed' });
    }
  });

  r.post('/api/telegram/stop', (_req, res) => {
    try {
      const eng = getEngine();
      // Stop running bridge
      if (eng.telegramBridge) {
        try { eng.telegramBridge.stop(); } catch (e) { /* ignore */ }
        eng.telegramBridge = null;
      }
      if (eng.gateway) {
        try { eng.gateway.stopChannel('telegram'); } catch (e) { /* ignore */ }
      }
      // Disable plugin but keep config so it auto-starts on next launch
      if (eng.pluginRegistry.isInstalled('telegram')) {
        eng.pluginRegistry.disable('telegram');
      }
      res.json({ ok: true, message: 'Telegram bot stopped. Config preserved for next launch.' });
    } catch (e) {
      getLogger().error('POST_API_TELEGRAM_STOP', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'clear-failed' });
    }
  });

  r.get('/api/telegram/status', (_req, res) => {
    const eng = getEngine();
    const plugin = eng.pluginRegistry.getPlugin('telegram');
    const configured = !!plugin?.enabled && !!plugin?.config?.['botToken'];
    const connected = configured && !!eng.telegramBridge?.isRunning();
    res.json({ configured, connected, botToken: configured ? '***configured***' : null });
  });

  r.post('/api/discord/start', async (req, res) => {
    try {
      const { token, channelId } = req.body as { token: string; channelId?: string };
      const eng = getEngine();
      const existing = eng.pluginRegistry.getPlugin('discord');
      if (existing) {
        eng.pluginRegistry.updateConfig('discord', { botToken: token, channelId });
      } else {
        const { getBuiltinPlugin } = await import('@agentx/engine');
        const entry = getBuiltinPlugin('discord');
        if (entry) {
          eng.pluginRegistry.install(entry);
          eng.pluginRegistry.updateConfig('discord', { botToken: token, channelId });
        }
      }

      // Persist to disk
      if (!eng.pgPool) throw new Error('PostgreSQL pool not available');
      const discordStore = new DiscordStore(eng.pgPool, eng.dek!);
      await discordStore.save({ botToken: token, channelId });

      // Stop existing bridge if any
      if (eng.discordBridge) {
        eng.discordBridge.stop();
        eng.discordBridge = null;
      }

      // Start the actual bridge
      const bridge = new DiscordBridge();
      bridge.setAgentFactory(async () => {
        const userCfg = eng.configManager.load();
        const userProvider = userCfg.provider.activeProvider as ProviderId;
        const userSession = eng.sessionManager.createSession(
          userProvider,
          userCfg.provider.activeModel,
          process.cwd(),
        );
        return new Agent({
          config: userCfg,
          sessionId: userSession.id,
          systemPrompt: '',
          toolExecutor: eng.toolkit.executor,
          toolRegistry: eng.toolkit.registry,
          pgPool: eng.pgPool ?? undefined,
        });
      });
      await bridge.start(token, channelId);
      eng.discordBridge = bridge;

      res.json({ ok: true, message: 'Discord bot connected.', status: bridge.getStatus() });
    } catch (e: unknown) {
      getLogger().error('POST_API_DISCORD_START', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'save-failed' });
    }
  });

  r.post('/api/discord/stop', async (_req, res) => {
    try {
      const eng = getEngine();
      if (eng.discordBridge) {
        eng.discordBridge.stop();
        eng.discordBridge = null;
      }
      if (eng.pluginRegistry.isInstalled('discord')) {
        eng.pluginRegistry.uninstall('discord');
      }
      if (eng.pgPool) {
        const discordStore = new DiscordStore(eng.pgPool, eng.dek!);
        await discordStore.clear();
      }
      res.json({ ok: true });
    } catch (e) {
      getLogger().error('POST_API_DISCORD_STOP', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'clear-failed' });
    }
  });

  r.get('/api/discord/status', (_req, res) => {
    const eng = getEngine();
    const plugin = eng.pluginRegistry.getPlugin('discord');
    const configured = !!plugin?.enabled && !!plugin?.config?.['botToken'];
    const bridge = eng.discordBridge;
    const connected = bridge?.getStatus().connected ?? false;
    const guilds = bridge?.getStatus().guilds ?? 0;
    res.json({ configured, connected, guilds });
  });

  r.post('/api/slack/start', async (req, res) => {
    try {
      const { botToken, appToken } = req.body as { botToken: string; appToken: string };
      if (!botToken || !appToken) {
        res.status(400).json({ error: 'botToken and appToken are required' });
        return;
      }
      const eng = getEngine();
      if (eng.slackBridge) {
        eng.slackBridge.stop();
        eng.slackBridge = null;
      }
      const bridge = new SlackBridge({ botToken, appToken });
      bridge.setAgentFactory((_userId) => {
        const cfg = eng.configManager.load();
        const session = eng.sessionManager.createSession(
          cfg.provider.activeProvider,
          cfg.provider.activeModel,
          process.cwd(),
        );
        return new Agent({
          config: cfg,
          sessionId: session.id,
          systemPrompt: '',
          toolExecutor: eng.toolkit.executor,
          toolRegistry: eng.toolkit.registry,
          pgPool: eng.pgPool ?? undefined,
        });
      });
      if (!eng.pgPool) throw new Error('PostgreSQL pool not available');
      await bridge.start();
      eng.slackBridge = bridge;
      const slackStore = new SlackStore(eng.pgPool, eng.dek!);
      await slackStore.save({ botToken, appToken });
      res.json({ ok: true, message: 'Slack bridge started.', status: bridge.getStatus() });
    } catch (e: unknown) {
      getLogger().error('POST_API_SLACK_START', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'start-failed' });
    }
  });

  r.post('/api/slack/stop', async (_req, res) => {
    try {
      const eng = getEngine();
      if (eng.slackBridge) {
        eng.slackBridge.stop();
        eng.slackBridge = null;
      }
      if (eng.pgPool) {
        const slackStore = new SlackStore(eng.pgPool, eng.dek!);
        await slackStore.clear();
      }
      res.json({ ok: true });
    } catch (e) {
      getLogger().error('POST_API_SLACK_STOP', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'stop-failed' });
    }
  });

  r.get('/api/slack/status', async (_req, res) => {
    try {
      const eng = getEngine();
      if (!eng.pgPool) throw new Error('PostgreSQL pool not available');
      const slackStore = new SlackStore(eng.pgPool, eng.dek!);
      const cfg = await slackStore.load();
      const bridge = eng.slackBridge;
      const configured = !!cfg?.botToken && !!cfg?.appToken;
      const status = bridge?.getStatus();
      res.json({
        configured,
        connected: status?.connected ?? false,
        team: status?.team ?? '',
      });
    } catch (e) {
      res.json({ configured: false, connected: false, team: '' });
    }
  });

  r.post('/api/email/start', async (req, res) => {
    try {
      const body = req.body as Record<string, string | undefined>;
      const smtpHost = body['smtpHost'] ?? '';
      const smtpPort = body['smtpPort'] ?? '';
      const smtpUser = body['smtpUser'] ?? '';
      const smtpPass = body['smtpPass'] ?? '';
      const fromAddress = body['fromAddress'] ?? '';
      const imapHost = body['imapHost'];
      const imapPort = body['imapPort'];
      const eng = getEngine();
      const existing = eng.pluginRegistry.getPlugin('email');
      const config = { smtpHost, smtpPort, smtpUser, smtpPass, fromAddress, imapHost, imapPort };
      if (existing) {
        eng.pluginRegistry.updateConfig('email', config);
      } else {
        const { getBuiltinPlugin } = await import('@agentx/engine');
        const entry = getBuiltinPlugin('email');
        if (entry) {
          eng.pluginRegistry.install(entry);
          eng.pluginRegistry.updateConfig('email', config);
        }
      }

      // Stop existing bridge if any
      if (eng.emailBridge) {
        eng.emailBridge.stop();
        eng.emailBridge = null;
      }

      // Start the real bridge
      const cfg = eng.configManager.load();
      const bridge = new EmailBridge();
      bridge.setAgentDeps({
        config: cfg,
        systemPrompt: '',
        toolExecutor: eng.toolkit.executor,
        toolRegistry: eng.toolkit.registry,
      });
      await bridge.start({
        smtpHost: smtpHost.trim(),
        smtpPort: Number(smtpPort) || 587,
        smtpUser: smtpUser.trim(),
        smtpPass: smtpPass.trim(),
        fromAddress: (fromAddress || smtpUser).trim(),
        imapHost: imapHost?.trim() || undefined,
        imapPort: imapPort ? Number(imapPort) : undefined,
      });
      eng.emailBridge = bridge;

      res.json({ ok: true, message: 'Email bridge configured and started.' });
    } catch (e: unknown) {
      getLogger().error('POST_API_EMAIL_START', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'save-failed' });
    }
  });

  r.post('/api/email/stop', (_req, res) => {
    try {
      const eng = getEngine();
      if (eng.emailBridge) {
        eng.emailBridge.stop();
        eng.emailBridge = null;
      }
      if (eng.pluginRegistry.isInstalled('email')) {
        eng.pluginRegistry.uninstall('email');
      }
      res.json({ ok: true });
    } catch (e) {
      getLogger().error('POST_API_EMAIL_STOP', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'clear-failed' });
    }
  });

  r.get('/api/email/status', (_req, res) => {
    try {
      const eng = getEngine();
      const plugin = eng.pluginRegistry.getPlugin('email');
      const configured = !!plugin?.enabled && !!plugin?.config?.['smtpHost'];
      const bridge = eng.emailBridge;
      const status = bridge?.getStatus();
      res.json({
        configured,
        connected: status?.connected ?? false,
        unreadCount: status?.unreadCount ?? 0,
      });
    } catch (e) {
      res.json({ configured: false, connected: false, unreadCount: 0 });
    }
  });


  // ═══ Channel conversation clear ═══
  // Wipes all messages, tool executions, and agent memory for a specific channel
  // session so the user can start fresh without any history context.
  // For Telegram, also deletes the bot's messages from the Telegram chat using
  // the stored platform message IDs (metadata.platformMessageIds / platformMessageId).
  r.post('/api/channels/:channelId/clear', async (req, res) => {
    try {
      const channelId = req.params['channelId'] as ChannelBindingId;
      const validChannels: ChannelBindingId[] = ['telegram', 'discord', 'slack', 'email'];
      if (!validChannels.includes(channelId)) {
        res.status(400).json({ error: `Invalid channel: ${channelId}` });
        return;
      }

      const eng = getEngine();
      const sessionId = channelSessionIdForBinding(channelId);
      const logger = getLogger('channels');
      const store = eng.sessionManager.getStorageAdapter();

      // 1. Read messages BEFORE purging so we can extract platform message IDs
      //    for deletion from the external channel (Telegram).
      let deletedFromPlatform = 0;
      if (channelId === 'telegram') {
        const tgBridge = getActiveTelegramBridge();
        if (tgBridge && store?.getMessages) {
          const messages = store.getMessages(sessionId);
          for (const msg of messages) {
            const chatId = msg.platformChatId;
            if (chatId == null || !Number.isFinite(chatId)) continue;
            // Assistant replies store an array of message_ids (one per chunk).
            const replyIds = msg.platformMessageIds;
            if (replyIds && Array.isArray(replyIds)) {
              for (const mid of replyIds) {
                try { await tgBridge.deleteMessage(chatId, mid); deletedFromPlatform++; } catch { /* best-effort */ }
              }
            }
            // User inbound messages store a single message_id.
            const userMsgId = msg.platformMessageId;
            if (userMsgId != null && Number.isFinite(userMsgId)) {
              try { await tgBridge.deleteMessage(chatId, userMsgId); deletedFromPlatform++; } catch { /* best-effort */ }
            }
          }
        }
      }

      // 2. Purge all session content from the DB (messages, parts, checkpoints, etc.)
      if (store?.purgeSessionContent) {
        store.purgeSessionContent(sessionId);
      } else if (store?.deleteMessages) {
        store.deleteMessages(sessionId);
      }

      // 3. Delete tool executions for this session
      try {
        (store as { query?: (sql: string, params: unknown[]) => void })?.query?.(
          'DELETE FROM tool_executions WHERE session_id = $1',
          [sessionId],
        );
      } catch {
        // Some storage adapters may not expose raw query — try via pool if available
        try {
          const pool = (eng.sessionManager as unknown as { pool?: { query: (sql: string, params: unknown[]) => Promise<unknown> } }).pool;
          if (pool) await pool.query('DELETE FROM tool_executions WHERE session_id = $1', [sessionId]);
        } catch { /* best-effort */ }
      }

      // 4. Clear the in-memory agent history and evict from cache
      const map = eng.channelAgents;
      const cachedAgent = map?.get(channelId);
      if (cachedAgent) {
        cachedAgent.clearHistory();
        cachedAgent.rebuildContext();
        cachedAgent.rebuildSystemPrompt();
        // Evict from cache so next access creates a fresh agent
        map?.delete(channelId);
        if (channelId === 'telegram') eng.channelAgent = null;
      }

      const platformNote = deletedFromPlatform > 0 ? ` (also deleted ${deletedFromPlatform} message(s) from Telegram)` : '';
      logger.info('CHANNELS', `Cleared conversation for ${channelId} (session: ${sessionId})${platformNote}`);
      res.json({ success: true, message: `Cleared all messages and tool executions for ${channelId}${platformNote}` });
    } catch (e) {
      const logger = getLogger('channels');
      logger.warn('CHANNELS', `Failed to clear channel: ${e instanceof Error ? e.message : String(e)}`);
      res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to clear channel' });
    }
  });

  // ═══ WhatsApp ═══
  // The WhatsApp session lifecycle is managed by WhatsAppSessionService on the
  // engine state. These routes provide the dashboard with status, link (QR),
  // stop, unlink, and pairing-code operations.

  // Soft-pause check: reads the runtime paused flag from the session service.
  // The flag is set automatically when the engine fails to connect on startup.
  function isWhatsAppPaused(): boolean {
    try {
      const eng = getEngine();
      return eng.whatsappSessionService?.paused === true;
    } catch {
      return false;
    }
  }

  const PAUSED_RESPONSE = {
    status: 'paused',
    paused: true,
    message: 'WhatsApp is temporarily disabled due to a connection failure (possible protocol update). This will be resolved in the next Agent-X update (usually within 48 hours). You can click Retry to try again, or wait for the update.',
  };

  r.get('/api/whatsapp/status', async (_req, res) => {
    try {
      if (isWhatsAppPaused()) {
        res.json(PAUSED_RESPONSE);
        return;
      }
      const eng = getEngine();
      const svc = eng.whatsappSessionService;
      if (!svc) {
        res.json({ status: 'not_configured', engine: 'baileys' });
        return;
      }
      const status = await svc.getStatus();
      // Use svc.getQr() which returns the cached PNG data URL (not the raw
      // QR string from the engine). Also included in status.qrDataUrl.
      const qr = svc.getQr();
      res.json({ ...status, qrDataUrl: qr ?? status.qrDataUrl });
    } catch (e) {
      getLogger('channels').warn('WHATSAPP', `Status error: ${e instanceof Error ? e.message : String(e)}`);
      res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to get WhatsApp status' });
    }
  });

  r.post('/api/whatsapp/link', async (_req, res) => {
    try {
      if (isWhatsAppPaused()) {
        res.status(503).json({ error: PAUSED_RESPONSE.message, paused: true });
        return;
      }
      const eng = getEngine();
      let svc = eng.whatsappSessionService;
      // Auto-enable: if WhatsApp isn't configured yet (e.g. user is in the
      // setup wizard and hasn't visited Settings → Channels), enable it in
      // the config and apply the channels config to create the session service.
      if (!svc) {
        const cfg = eng.configManager.load();
        if (!cfg.channels?.whatsapp?.enabled) {
          eng.configManager.save({
            ...cfg,
            channels: {
              ...cfg.channels,
              whatsapp: { ...cfg.channels?.whatsapp, enabled: true, inbound: true, outbound: true },
            },
          });
          // Apply the updated config to start the WhatsApp session service
          const { applyChannelsConfig } = await import('../../channels/config.js');
          await applyChannelsConfig();
          svc = eng.whatsappSessionService;
        }
      }
      if (!svc) {
        res.status(400).json({ error: 'WhatsApp could not be initialized. Please try again.' });
        return;
      }
      const status = await svc.getStatus();
      if (status.status === 'ready') {
        res.json({ ok: true, status: 'ready', message: 'Already linked', phoneNumber: status.phoneNumber });
        return;
      }
      // link() is idempotent — if the engine is already active (e.g. from
      // reconcileOnBoot), it returns without throwing. After link(), we wait
      // for the QR to be generated (Baileys generates it asynchronously
      // after initialize() returns).
      await svc.link();
      const qr = await svc.waitForQr(15_000);
      const newStatus = await svc.getStatus();
      res.json({ ok: true, status: newStatus.status, qrDataUrl: qr ?? newStatus.qrDataUrl });
    } catch (e) {
      getLogger('channels').warn('WHATSAPP', `Link error: ${e instanceof Error ? e.message : String(e)}`);
      res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to start WhatsApp linking' });
    }
  });

  r.post('/api/whatsapp/stop', async (_req, res) => {
    try {
      if (isWhatsAppPaused()) {
        res.json({ ok: true, message: 'WhatsApp is paused' });
        return;
      }
      const eng = getEngine();
      const svc = eng.whatsappSessionService;
      if (!svc) {
        res.json({ ok: true, message: 'WhatsApp is not active' });
        return;
      }
      await svc.stop();
      res.json({ ok: true, message: 'WhatsApp session stopped' });
    } catch (e) {
      getLogger('channels').warn('WHATSAPP', `Stop error: ${e instanceof Error ? e.message : String(e)}`);
      res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to stop WhatsApp' });
    }
  });

  r.post('/api/whatsapp/unlink', async (_req, res) => {
    try {
      if (isWhatsAppPaused()) {
        res.status(503).json({ error: PAUSED_RESPONSE.message, paused: true });
        return;
      }
      const eng = getEngine();
      const svc = eng.whatsappSessionService;
      if (!svc) {
        res.json({ ok: true, message: 'WhatsApp is not configured' });
        return;
      }
      await svc.unlink();
      res.json({ ok: true, message: 'WhatsApp unlinked. All credentials purged.' });
    } catch (e) {
      getLogger('channels').warn('WHATSAPP', `Unlink error: ${e instanceof Error ? e.message : String(e)}`);
      res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to unlink WhatsApp' });
    }
  });

  r.post('/api/whatsapp/pairing-code', async (req, res) => {
    try {
      if (isWhatsAppPaused()) {
        res.status(503).json({ error: PAUSED_RESPONSE.message, paused: true });
        return;
      }
      const eng = getEngine();
      let svc = eng.whatsappSessionService;
      if (!svc) {
        const cfg = eng.configManager.load();
        if (!cfg.channels?.whatsapp?.enabled) {
          eng.configManager.save({
            ...cfg,
            channels: {
              ...cfg.channels,
              whatsapp: { ...cfg.channels?.whatsapp, enabled: true, inbound: true, outbound: true },
            },
          });
          const { applyChannelsConfig } = await import('../../channels/config.js');
          await applyChannelsConfig();
          svc = eng.whatsappSessionService;
        }
      }
      if (!svc) {
        res.status(400).json({ error: 'WhatsApp could not be initialized. Please try again.' });
        return;
      }
      const { phoneNumber } = req.body as { phoneNumber?: string };
      if (!phoneNumber?.trim()) {
        res.status(400).json({ error: 'phoneNumber is required' });
        return;
      }
      const code = await svc.requestPairingCode(phoneNumber.trim());
      res.json({ ok: true, pairingCode: code });
    } catch (e) {
      getLogger('channels').warn('WHATSAPP', `Pairing code error: ${e instanceof Error ? e.message : String(e)}`);
      res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to request pairing code' });
    }
  });

  // Retry connecting after a soft-pause. Attempts to re-link the engine —
  // if it succeeds, clears the paused flag and returns success. If it still
  // fails, stays paused and returns the error.
  r.post('/api/whatsapp/retry', async (_req, res) => {
    try {
      const eng = getEngine();
      const svc = eng.whatsappSessionService;
      if (!svc) {
        res.status(400).json({ error: 'WhatsApp is not enabled' });
        return;
      }
      if (!svc.paused) {
        res.json({ ok: true, paused: false, message: 'WhatsApp is not paused' });
        return;
      }
      const success = await svc.retry();
      if (success) {
        const status = await svc.getStatus();
        res.json({
          ok: true,
          paused: false,
          status: status.status,
          phoneNumber: status.phoneNumber,
          message: 'WhatsApp reconnected successfully',
        });
      } else {
        res.status(503).json({
          ok: false,
          paused: true,
          error: 'Retry failed — WhatsApp is still unable to connect. This may be due to a protocol update. Please try again later or wait for the next Agent-X update.',
        });
      }
    } catch (e) {
      getLogger('channels').warn('WHATSAPP', `Retry error: ${e instanceof Error ? e.message : String(e)}`);
      res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to retry WhatsApp connection' });
    }
  });

  return r;
}
