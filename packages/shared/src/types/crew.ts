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
  createdAt: string;
  updatedAt: string;
}

export interface CrewCreateInput {
  id: string;
  name: string;
  systemPrompt: string;
  emotion?: CrewEmotion;
  isDefault?: boolean;
}
