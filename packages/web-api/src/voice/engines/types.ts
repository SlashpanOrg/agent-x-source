import type { WebSocket } from 'ws';
import type { VoiceSessionMode, VoiceConfig, ClientSituation } from '@agentx/shared';
import type { WebSocketVoiceTransport } from '@agentx/engine';

export type VoiceEngineType = 'stt_llm_tts' | 'realtime_xai';

export type VoiceEngineState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

export interface VoiceEngineSession {
  sessionId: string;
  chatSessionId?: string;
  mode: VoiceSessionMode;
  getState(): VoiceEngineState;
  onBinaryAudio(_pcm: Buffer): void;
  onClientMessage(_msg: Record<string, unknown>): Promise<void>;
  onDisconnect(): void;
  /** Optional system line spoken into an active voice session (WhatsApp Jarvis briefs). */
  announce?(line: string, context?: string): Promise<void>;
}

export interface VoiceEngineSessionOptions {
  ws: WebSocket;
  transport: WebSocketVoiceTransport;
  sessionId: string;
  mode: VoiceSessionMode;
  chatSessionId?: string;
  clientSituation?: ClientSituation | null;
  /**
   * Optional voice config override (e.g. per-crew voice profile for crew calls).
   * When provided, the engine uses this instead of the global config. The xAI
   * voice ID is read from voiceConfig.xai?.voice.
   */
  voiceConfig?: VoiceConfig;
  /** Wake-word mode: server-side wake-phrase gating. */
  wakeWord?: boolean;
  /** Wake phrase for server-side gating. */
  wakePhrase?: string;
}

export interface VoiceEngine {
  readonly type: VoiceEngineType;
  start(): Promise<void>;
  createSession(_options: VoiceEngineSessionOptions): Promise<VoiceEngineSession>;
  closeSession(_session: VoiceEngineSession): Promise<void>;
}
