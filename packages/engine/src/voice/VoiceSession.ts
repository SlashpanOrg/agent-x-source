import type { VoiceSessionMode, VoiceTransportKind } from '@agentx/shared';

export type VoiceSessionState = 'idle' | 'listening' | 'transcribing' | 'agent_running' | 'speaking' | 'error' | 'closed';

export interface VoiceSessionSpeaker {
  id?: string | null;
  name?: string | null;
  isRoot: boolean;
  confidence?: number | null;
  recognized?: boolean;
}

export interface VoiceSessionOptions {
  sessionId: string;
  transport: VoiceTransportKind;
  mode: VoiceSessionMode;
  userId?: string;
  channelId?: string;
}

export class VoiceSession {
  readonly sessionId: string;
  readonly transport: VoiceTransportKind;
  readonly mode: VoiceSessionMode;
  readonly userId?: string;
  readonly channelId?: string;
  state: VoiceSessionState = 'idle';
  error?: string;
  speaker?: VoiceSessionSpeaker;

  constructor(options: VoiceSessionOptions) {
    this.sessionId = options.sessionId;
    this.transport = options.transport;
    this.mode = options.mode;
    this.userId = options.userId;
    this.channelId = options.channelId;
  }

  setState(state: VoiceSessionState): void {
    this.state = state;
    if (state !== 'error') {
      this.error = undefined;
    }
  }

  fail(error: unknown): void {
    this.state = 'error';
    this.error = error instanceof Error ? error.message : String(error);
  }

  close(): void {
    this.state = 'closed';
  }
}
