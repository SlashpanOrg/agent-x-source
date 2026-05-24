export type ProfileEmotion =
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

export interface Profile {
  id: string;
  name: string;
  systemPrompt: string;
  emotion?: ProfileEmotion;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileCreateInput {
  id: string;
  name: string;
  systemPrompt: string;
  emotion?: ProfileEmotion;
  isDefault?: boolean;
}
