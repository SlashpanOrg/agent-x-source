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
   * @deprecated Ignored. WhatsApp is Jarvis-mode: world messages brief the
   * owner; standing orders control any auto-send.
   */
  autoReplyMode?: 'saved_contacts' | 'allowlist' | 'all';
  /** @deprecated Ignored. Use standing orders. */
  allowedJids?: string[];
  /** @deprecated Ignored. Use standing orders or whatsapp_block_contact. */
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
