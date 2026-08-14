export type StandingOrderChatKind = 'dm' | 'group' | 'any';
export type StandingOrderActionType = 'brief' | 'auto_reply' | 'ignore';
export type StandingOrderSource = 'self_chat' | 'voice' | 'desktop' | 'unknown';

export interface StandingOrderMatch {
  senders?: string[];
  groups?: string[];
  keywords?: string[];
  chatKind?: StandingOrderChatKind;
}

export interface StandingOrderAction {
  type: StandingOrderActionType;
  replyTemplate?: string;
  announceVoice?: boolean;
}

export interface StandingOrder {
  id: string;
  title: string;
  enabled: boolean;
  priority: number;
  match: StandingOrderMatch;
  action: StandingOrderAction;
  createdFrom: StandingOrderSource;
  createdAt: string;
  updatedAt: string;
}

export interface StandingOrderWrite {
  id?: string;
  title: string;
  enabled?: boolean;
  priority?: number;
  match: StandingOrderMatch;
  action: StandingOrderAction;
  createdFrom?: StandingOrderSource;
}

export interface WorldEvent {
  senderJid: string;
  chatId: string;
  text: string;
  isGroup: boolean;
}
