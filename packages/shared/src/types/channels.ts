/** Bidirectional channel configuration (Settings → Channels). */
export type NotificationChannelId = 'telegram' | 'slack' | 'email' | 'discord' | 'whatsapp';

export interface TelegramChannelConfig {
  enabled?: boolean;
  inbound?: boolean;
  outbound?: boolean;
  botToken?: string;
  chatId?: string;
  /**
   * Telegram user ID allowed for inbound (set automatically on Verify).
   * Stored as a single ID string; only this user may message the bot.
   */
  allowedUserIds?: string;
}

export interface SlackChannelConfig {
  enabled?: boolean;
  inbound?: boolean;
  outbound?: boolean;
  webhookUrl?: string;
  botToken?: string;
  appToken?: string;
  /** Comma-separated Slack user IDs allowed for inbound DMs/mentions (required in server mode). */
  allowedUserIds?: string;
}

export interface EmailChannelConfig {
  enabled?: boolean;
  inbound?: boolean;
  outbound?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  fromAddress?: string;
  toAddress?: string;
  useTls?: boolean;
}

export interface DiscordChannelConfig {
  enabled?: boolean;
  inbound?: boolean;
  outbound?: boolean;
  webhookUrl?: string;
  botToken?: string;
  channelId?: string;
  /** Comma-separated Discord user IDs allowed for inbound DMs/mentions (required in server mode). */
  allowedUserIds?: string;
}

export interface WhatsAppChannelConfig {
  enabled?: boolean;
  inbound?: boolean;
  outbound?: boolean;
  /**
   * Which WhatsApp engine to use. Defaults to 'baileys' (the primary engine).
   * Set to 'electron-wwebjs' to use the whatsapp-web.js fallback that attaches
   * to Electron's own Chromium via CDP.
   */
  engine?: 'baileys' | 'electron-wwebjs';
  /**
   * Inbound auto-reply policy:
   * - 'saved_contacts' (default): Only reply to contacts saved in the user's
   *   phone address book. Unknown numbers and business promotions are silently
   *   dropped — no auto-reply. The user can explicitly allow a number via chat.
   * - 'allowlist': Only reply to JIDs in `allowedJids`. All others are dropped.
   * - 'all': Reply to all inbound messages (not recommended — spam risk).
   */
  autoReplyMode?: 'saved_contacts' | 'allowlist' | 'all';
  /**
   * Explicitly allowed JIDs (WhatsApp user IDs, e.g. `917010541995@s.whatsapp.net`).
   * Used when `autoReplyMode` is 'allowlist', or as a supplement to
   * 'saved_contacts' mode (numbers the user explicitly allowed even though
   * they're not in the phone's address book).
   */
  allowedJids?: string[];
  /**
   * Explicitly blocked JIDs. Messages from these senders are always dropped,
   * regardless of `autoReplyMode`. Useful for blocking spam that passes the
   * saved-contacts check (e.g. a saved contact that sends promotional content).
   */
  blockedJids?: string[];
}

export interface NotificationChannelsConfig {
  telegram?: TelegramChannelConfig;
  slack?: SlackChannelConfig;
  email?: EmailChannelConfig;
  discord?: DiscordChannelConfig;
  whatsapp?: WhatsAppChannelConfig;
}

export type NotificationChannelStatus = Record<NotificationChannelId, { configured: boolean; enabled: boolean }>;

export interface TelegramDiscoveredChat {
  id: string;
  title: string;
  type: string;
  /** Telegram user id of the message sender (set for private chats during discover). */
  userId?: string;
}
