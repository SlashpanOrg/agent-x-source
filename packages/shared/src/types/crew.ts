export type CrewEmotion =
  | 'professional'
  | 'friendly'
  | 'witty'
  | 'kind'
  | 'funny'
  | 'arrogant'
  | 'flirty'
  | 'happy'
  | 'sad'
  | 'sarcastic';

export interface Crew {
  id: string;
  name: string;
  systemPrompt: string;
  emotion?: CrewEmotion;
  isDefault: boolean;
  enabled: boolean;
  expertise?: string[];
  traits?: string[];
  toolPreferences?: {
    enabled?: string[];
    disabled?: string[];
  };
  createdAt: string;
  updatedAt: string;
}

export interface CrewCreateInput {
  id: string;
  name: string;
  systemPrompt: string;
  emotion?: CrewEmotion;
  isDefault?: boolean;
  enabled?: boolean;
  expertise?: string[];
  traits?: string[];
  toolPreferences?: {
    enabled?: string[];
    disabled?: string[];
  };
}

export interface SessionCrewState {
  crewId: string;
  enabled: boolean;
  lastActive?: string;
  messageCount?: number;
}
