/**
 * IWhatsAppEngine — the neutral contract every WhatsApp engine adapter
 * implements (BaileysEngine primary, ElectronWebJsEngine fallback).
 *
 * Written from scratch against the general shape of the problem (WhatsApp
 * session lifecycle + messaging), not copied from any reference project. Only
 * one instance of an engine is ever active at a time (single-session scope —
 * see WHATSAPP_INTEGRATION_PLAN.md Ground Rule 7), so nothing here takes or
 * returns a session id.
 */

/** Lifecycle state machine for a WhatsApp engine instance. */
export enum EngineStatus {
  DISCONNECTED = 'disconnected',
  INITIALIZING = 'initializing',
  QR_READY = 'qr_ready',
  PAIRING = 'pairing',
  AUTHENTICATING = 'authenticating',
  READY = 'ready',
  FAILED = 'failed',
}

/** Neutral message-type vocabulary, independent of the underlying engine's own type strings. */
export type WhatsAppMessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'voice'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'poll'
  | 'call'
  | 'revoked'
  | 'unknown';

export type WhatsAppMessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

/** A message normalized to Agent-X's canonical shape (built by WhatsAppMessageMapper, Phase 4). */
export interface WhatsAppIncomingMessage {
  id: string;
  chatId: string;
  from: string;
  to: string;
  /** For group messages, the participant who actually sent it. */
  author?: string;
  fromMe: boolean;
  isGroup: boolean;
  type: WhatsAppMessageType;
  body: string;
  timestamp: number;
  quotedMessageId?: string;
  mentions?: string[];
  isLidSender?: boolean;
  senderPhone?: string;
  pushName?: string;
  ephemeralDuration?: number;
  media?: {
    mimetype: string;
    /** Base64-encoded media bytes, or omitted if it exceeded the inbound media cap. */
    data?: string;
    omitted?: boolean;
    sizeBytes?: number;
    fileName?: string;
    caption?: string;
  };
  /** Set after inbound persist when media was stored in the attachment service. */
  attachmentId?: string;
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  raw: unknown;
}

export interface WhatsAppMessageAck {
  messageId: string;
  chatId: string;
  status: WhatsAppMessageStatus;
}

export interface WhatsAppSendResult {
  messageId: string;
  timestamp: number;
}

export interface WhatsAppLocationContent {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface WhatsAppContactContent {
  displayName: string;
  phone: string;
  organization?: string;
}

/** A contact entry from the engine's contact store. */
export interface WhatsAppContactEntry {
  /** Neutral JID when possible (`phone@c.us`); may be `@lid` if phone unknown. */
  jid: string;
  /** Raw engine id (Baileys `@s.whatsapp.net` / `@lid`, etc.). */
  rawJid?: string;
  /** Phone digits (no +), when known */
  phoneNumber?: string;
  /** Best display name (saved ?? notify ?? business) */
  name?: string;
  /** Name the owner saved in their address book */
  savedName?: string;
  /** Name the contact set for themselves on WhatsApp */
  notify?: string;
  /** WhatsApp Business verified / business name */
  businessName?: string;
  /** WhatsApp username, when provided */
  username?: string;
  /** Profile picture URL, if available */
  imgUrl?: string | null;
  /** About/status text, if available */
  status?: string;
}

export interface WhatsAppCallEvent {
  callId: string;
  from: string;
  isVideo: boolean;
  timestamp: number;
}

export interface WhatsAppGroupEvent {
  groupId: string;
  author: string;
  participants: string[];
  action: 'add' | 'remove' | 'promote' | 'demote';
}

/** A participant in a group, normalized from the engine's group metadata. */
export interface WhatsAppGroupParticipant {
  jid: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  admin?: 'admin' | 'superadmin' | null;
}

/** Group metadata normalized to Agent-X's canonical shape. */
export interface WhatsAppGroupInfo {
  groupId: string;
  subject: string;
  subjectOwner?: string;
  creation?: number;
  owner?: string;
  description?: string;
  descriptionId?: string;
  size?: number;
  restrict?: boolean;
  announce?: boolean;
  participants: WhatsAppGroupParticipant[];
  inviteCode?: string;
}

/** A single reaction on a message. */
export interface WhatsAppReactionEntry {
  messageId: string;
  chatId: string;
  senderId: string;
  emoji: string | null;
  timestamp?: number;
}

/** A channel (newsletter) the user follows or can subscribe to. */
export interface WhatsAppChannel {
  jid: string;
  name?: string;
  description?: string;
  subscribers?: number;
}

/** Info passed with the `ready` status transition. */
export interface EngineReadyInfo {
  phoneNumber?: string;
  pushName?: string;
}

/** Event callbacks the engine invokes as things happen. Registered once via `setCallbacks()`. */
export interface WhatsAppEngineCallbacks {
  onQRCode?: (dataUrl: string) => void;
  onPairingCode?: (code: string) => void;
  onStateChanged?: (status: EngineStatus, info?: EngineReadyInfo) => void;
  onMessage?: (message: WhatsAppIncomingMessage) => void;
  onMessageSent?: (message: WhatsAppIncomingMessage) => void;
  onMessageAck?: (ack: WhatsAppMessageAck) => void;
  onMessageRevoked?: (chatId: string, messageId: string) => void;
  onMessageReaction?: (chatId: string, messageId: string, senderId: string, emoji: string | null) => void;
  onMessageEdited?: (message: WhatsAppIncomingMessage) => void;
  onGroupEvent?: (event: WhatsAppGroupEvent) => void;
  onCallReceived?: (call: WhatsAppCallEvent) => void;
  onDisconnected?: (reason: string) => void;
  onError?: (error: Error) => void;
  /** Address-book / profile-name updates. Session service indexes these. */
  onContactsChanged?: (contacts: WhatsAppContactEntry[]) => void;
}

/**
 * A minimal capability probe result used by the Phase 2.6 capability matrix
 * and by tools to give a clear "not supported on this engine" error instead
 * of letting a library call throw an opaque exception.
 */
export type EngineCapability =
  | 'labels'
  | 'catalog'
  | 'statusStories'
  | 'channels'
  | 'chatHistoryFetch'
  | 'messageReactionsQuery'
  | 'rejectCall'
  | 'groupManagement';

export interface IWhatsAppEngine {
  readonly name: 'baileys' | 'electron-wwebjs';

  setCallbacks(callbacks: WhatsAppEngineCallbacks): void;

  /** Start connecting. Resolves once initialization has been kicked off (not necessarily READY). */
  initialize(): Promise<void>;

  /** Graceful disconnect — engine may be reused/reinitialized afterwards. */
  disconnect(): Promise<void>;

  /** Hard kill for a wedged engine — local teardown only. Must NOT logout/unlink the phone. */
  forceDestroy(): Promise<void>;

  /**
   * Revoke this device on WhatsApp's servers (like logging out of WhatsApp Web).
   * Only the owner's explicit unlink should call this.
   */
  logoutFromServer?(): Promise<void>;

  /** Neutral JIDs for the linked handset (phone@c.us and/or lid). Used for self-chat. */
  getLinkedUserJids?(): string[];

  getStatus(): EngineStatus;

  /** Data-URL PNG of the current QR code, or null if not in QR_READY state. */
  getQr(): string | null;

  requestPairingCode(phoneNumber: string): Promise<string>;

  /** Cheap liveness probe used by the session watchdog (Phase 3.3). Not all engines can implement this meaningfully. */
  probeLiveness?(): Promise<boolean>;

  supportsCapability(capability: EngineCapability): boolean;

  // --- Messaging -----------------------------------------------------------
  sendText(chatId: string, text: string, opts?: { mentions?: string[]; quotedMessageId?: string; quotedFromMe?: boolean }): Promise<WhatsAppSendResult>;
  sendImage(chatId: string, media: { data: string; mimetype: string; caption?: string }): Promise<WhatsAppSendResult>;
  sendVideo(chatId: string, media: { data: string; mimetype: string; caption?: string }): Promise<WhatsAppSendResult>;
  sendAudio(chatId: string, media: { data: string; mimetype: string; ptt?: boolean }): Promise<WhatsAppSendResult>;
  sendDocument(chatId: string, media: { data: string; mimetype: string; fileName: string; caption?: string }): Promise<WhatsAppSendResult>;
  sendLocation(chatId: string, location: WhatsAppLocationContent): Promise<WhatsAppSendResult>;
  sendContact(chatId: string, contact: WhatsAppContactContent): Promise<WhatsAppSendResult>;
  sendPoll(chatId: string, question: string, options: string[], opts?: { selectableCount?: number }): Promise<WhatsAppSendResult>;
  sendSticker(chatId: string, media: { data: string; mimetype: string }): Promise<WhatsAppSendResult>;
  reply(chatId: string, quotedMessageId: string, text: string): Promise<WhatsAppSendResult>;
  forwardMessage(chatId: string, sourceChatId: string, messageId: string): Promise<WhatsAppSendResult>;
  react(chatId: string, messageId: string, emoji: string | null, opts?: { fromMe?: boolean }): Promise<void>;
  /**
   * Show or clear the chat composing indicator. WhatsApp expires this after a
   * few seconds — callers refresh it while a long turn is running.
   */
  setTyping?(chatId: string, typing: boolean): Promise<void>;
  editMessage(chatId: string, messageId: string, newText: string): Promise<void>;
  deleteMessage(chatId: string, messageId: string, forEveryone: boolean): Promise<void>;

  // --- Contacts / chats ------------------------------------------------------
  checkNumberExists(phoneNumber: string): Promise<{ exists: boolean; jid?: string }>;
  blockContact(jid: string): Promise<void>;
  unblockContact(jid: string): Promise<void>;

  /**
   * List known contacts from the engine's contact store.
   * Returns contacts that have a name or notify name (i.e. saved contacts
   * or contacts that have set a WhatsApp profile name).
   * @param opts.limit - Maximum number of contacts to return (default 100).
   * @param opts.search - Optional search filter (case-insensitive, matches name/notify/phone).
   */
  listContacts?(opts?: { limit?: number; search?: string }): Promise<WhatsAppContactEntry[]>;

  /**
   * Check if a JID corresponds to a contact saved in the user's phone address book.
   * Baileys exposes this via `Contact.name` — the name the user saved on their phone.
   * Contacts that only have `notify` (WhatsApp profile name) or `verifiedName`
   * (business account) are NOT saved contacts.
   *
   * Returns `{ saved: boolean, name?: string }` — `saved` is true only if the
   * contact has a user-assigned name in the address book.
   */
  isSavedContact?(jid: string): { saved: boolean; name?: string };

  // --- Calls -----------------------------------------------------------------
  rejectCall(callId: string): Promise<void>;

  // --- Message history & reactions (Phase 6.2 extended) ---------------------
  /**
   * Fetch recent messages for a chat from the engine's local store.
   * Engines that disable full history sync (e.g. Baileys) return messages
   * observed since the session connected. Returns newest-first.
   * @param limit - Maximum number of messages to return (default 50).
   */
  getMessageHistory?(chatId: string, limit?: number): Promise<WhatsAppIncomingMessage[]>;

  /**
   * Fetch reactions recorded for a specific message from the engine's local
   * store. Returns reactions observed since the session connected.
   */
  getReactions?(chatId: string, messageId: string): Promise<WhatsAppReactionEntry[]>;

  // --- Profile pictures -----------------------------------------------------
  /** Resolve a profile picture URL for a JID (or null if none/privacy-restricted). */
  getProfilePicture?(jid: string): Promise<{ url: string | null }>;

  // --- Group management (requires 'groupManagement' capability) --------------
  createGroup?(subject: string, participants: string[]): Promise<{ groupId: string }>;
  getGroupInfo?(groupId: string): Promise<WhatsAppGroupInfo>;
  addParticipants?(groupId: string, participants: string[]): Promise<void>;
  removeParticipants?(groupId: string, participants: string[]): Promise<void>;
  promoteParticipant?(groupId: string, participant: string): Promise<void>;
  demoteParticipant?(groupId: string, participant: string): Promise<void>;
  setGroupSubject?(groupId: string, subject: string): Promise<void>;
  setGroupDescription?(groupId: string, description: string): Promise<void>;
  leaveGroup?(groupId: string): Promise<void>;
  joinGroupByInvite?(inviteCode: string): Promise<{ groupId: string }>;

  // --- Profile management ---------------------------------------------------
  setProfileName?(name: string): Promise<void>;
  setProfileStatus?(status: string): Promise<void>;
  /** Set the profile picture from base64-encoded media bytes. */
  setProfilePicture?(media: { data: string; mimetype: string }): Promise<void>;

  // --- Status stories (requires 'statusStories' capability) ------------------
  postTextStatus?(text: string): Promise<WhatsAppSendResult>;
  postImageStatus?(media: { data: string; mimetype: string; caption?: string }): Promise<WhatsAppSendResult>;
  listStatusUpdates?(): Promise<{ jid: string; timestamp?: number }[]>;

  // --- Channels / newsletters (requires 'channels' capability) ---------------
  subscribeChannel?(inviteCode: string): Promise<{ jid: string }>;
  listChannels?(): Promise<WhatsAppChannel[]>;
}
