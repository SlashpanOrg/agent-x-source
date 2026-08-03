export type FasterWhisperComputeType = 'auto' | 'int8' | 'int8_float16' | 'float16' | 'float32';

export type VoiceComputeDevice = 'auto' | 'cpu' | 'cuda';

export type TtsEngine = 'kokoro';

export interface VoiceSidecarHealth {
  ok: boolean;
  state: 'starting' | 'ready' | 'error';
  version?: string;
  models?: {
    sttLoaded?: boolean;
    ttsEngine?: TtsEngine;
    ttsLoaded?: boolean;
    vadLoaded?: boolean;
    speakerLoaded?: boolean;
  };
  device?: VoiceComputeDevice;
  error?: string;
}

export interface VoiceSidecarWarmRequest {
  sttModelId?: string;
  sttComputeType?: FasterWhisperComputeType;
  sttDevice?: VoiceComputeDevice;
  ttsEngine?: TtsEngine;
  ttsVoiceId?: string;
}

export interface VoiceSidecarTranscribeRequest {
  audioPath: string;
  modelId?: string;
  language?: string;
}

export interface VoiceSidecarTranscriptSegment {
  text: string;
  startMs?: number;
  endMs?: number;
  confidence?: number;
}

export interface VoiceSidecarTranscribeResponse {
  text: string;
  language?: string;
  confidence?: number;
  segments?: VoiceSidecarTranscriptSegment[];
  timings?: Record<string, number>;
}

export interface VoiceSidecarSynthesizeRequest {
  text: string;
  engine: TtsEngine;
  voiceId?: string;
  outputPath?: string;
  style?: {
    emotion?: string;
    expressiveness?: number;
  };
}

export interface VoiceSidecarSynthesizeResponse {
  audioPath?: string;
  sampleRate?: number;
  durationMs?: number;
  timings?: Record<string, number>;
}

export interface VoiceSidecarStreamTranscribeRequest {
  pcmBase64?: string;
  sampleRate?: number;
  reset?: boolean;
  finalize?: boolean;
  /** Decode request PCM for live captions without mutating the stream buffer. */
  preview?: boolean;
  modelId?: string;
  language?: string;
}

export interface VoiceSidecarStreamTranscribeResponse {
  partial?: string | null;
  text?: string | null;
  isSpeech?: boolean | null;
  speechEnd?: boolean;
  segments?: VoiceSidecarTranscriptSegment[];
  language?: string;
  confidence?: number;
  vad?: VoiceSidecarVadDetectResponse;
}

export interface VoiceSidecarStreamSynthesizeRequest {
  text: string;
  engine: TtsEngine;
  voiceId?: string;
  requestId?: string;
  style?: {
    emotion?: string;
    expressiveness?: number;
  };
}

export interface VoiceSidecarStreamAudioChunk {
  pcmBase64: string;
  sampleRate: number;
}

export interface VoiceSidecarStreamSynthesizeResponse {
  chunks: VoiceSidecarStreamAudioChunk[];
}

export interface VoiceSidecarCancelRequest {
  requestId: string;
}

export interface VoiceSidecarVadDetectRequest {
  pcm: string;
  sampleRate?: number;
  threshold?: number;
}

export interface VoiceSidecarVadDetectResponse {
  isSpeech: boolean;
  confidence?: number;
  speechStartMs?: number | null;
  speechEndMs?: number | null;
}

export interface VoiceSidecarSpeakerSample {
  id: string;
  embedding?: number[];
  sampleB64?: string;
  sampleRate?: number;
  createdAt?: string;
}

export interface VoiceSidecarSpeakerProfile {
  id: string;
  name: string;
  isRoot?: boolean;
  embedding?: number[];
  sampleB64?: string;
  samples?: VoiceSidecarSpeakerSample[];
  createdAt?: string;
}

export interface VoiceSidecarSpeakerExtractRequest {
  pcm: string;
  sampleRate?: number;
}

export interface VoiceSidecarSpeakerExtractResponse {
  ok: boolean;
  embedding: number[];
}

export interface VoiceSidecarSpeakerIdentifyRequest {
  pcm: string;
  sampleRate?: number;
  threshold?: number;
}

export interface VoiceSidecarSpeakerIdentifyResponse {
  ok: boolean;
  speakerId?: string | null;
  speakerName?: string | null;
  confidence?: number | null;
  recognized?: boolean;
  isRoot?: boolean;
  rootName?: string | null;
  matches?: { speakerId?: string | null; speakerName?: string | null; confidence?: number | null; isRoot?: boolean }[];
}

export interface VoiceSidecarSpeakerEnrollRequest {
  name: string;
  pcm: string;
  sampleRate?: number;
  isRoot?: boolean;
  profileId?: string;
}

export interface VoiceSidecarSpeakerEnrollResponse {
  ok: boolean;
  profile: VoiceSidecarSpeakerProfile;
}

export interface VoiceSidecarSpeakerListResponse {
  ok: boolean;
  profiles: VoiceSidecarSpeakerProfile[];
}

export interface VoiceSidecarSpeakerDeleteRequest {
  profileId: string;
}

export interface VoiceSidecarSpeakerDeleteResponse {
  ok: boolean;
}

export interface VoiceSidecarSpeakerSetRootRequest {
  profileId: string;
}

export interface VoiceSidecarSpeakerSetRootResponse {
  ok: boolean;
  profile?: VoiceSidecarSpeakerProfile | null;
}

export interface VoiceSidecarSpeakerUpdateRequest {
  profileId: string;
  name: string;
}

export interface VoiceSidecarSpeakerUpdateResponse {
  ok: boolean;
  profile?: VoiceSidecarSpeakerProfile | null;
}
