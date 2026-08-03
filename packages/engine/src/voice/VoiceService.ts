import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { TtsEngine, VoiceConfig } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { convertOggToWav16kMono } from './audio/ffmpeg.js';
import { cleanupVoiceTempDir, VOICE_LIMITS } from './audio/tempCleanup.js';
import { FillerCache } from './FillerCache.js';
import { mergeVoiceConfig } from './VoiceAssetCatalog.js';
import { normalizeTextForSpeech } from './speech/normalize.js';
import { VoiceProgressSession } from './VoiceProgressSession.js';
import { VoiceSession, type VoiceSessionSpeaker } from './VoiceSession.js';
import { VoiceSidecarManager } from './sidecar/VoiceSidecarManager.js';
import { SpeakerService } from './SpeakerService.js';
import type { SpeakerIdentificationResult } from './SpeakerStore.js';
import type { SpeakerProfile } from '@agentx/shared';
import { shouldSpeakVoiceAckFiller } from './voiceFillerPolicy.js';
import type { VoiceSidecarStreamAudioChunk, VoiceSidecarSynthesizeResponse, VoiceSidecarTranscribeResponse } from './sidecar/VoiceSidecarProtocol.js';

export type VoiceStreamSynthesizeResult = { chunks: AsyncGenerator<VoiceSidecarStreamAudioChunk>; requestId: string };

export interface VoiceServiceOptions {
  dataDir: string;
  config?: VoiceConfig;
  pythonExecutable?: string;
  sidecarEnv?: NodeJS.ProcessEnv;
  /** Shared sidecar manager (must use voice venv + PYTHONPATH). */
  sidecar?: VoiceSidecarManager;
}

export interface VoiceTranscribeFileOptions {
  language?: string;
  keepTemp?: boolean;
}

export interface VoiceSynthesizeOptions {
  engine?: TtsEngine;
  voiceId?: string;
  style?: {
    emotion?: string;
    expressiveness?: number;
  };
  forFiller?: boolean;
  requestId?: string;
}

/** Default voice ID for each TTS engine. */
const DEFAULT_VOICE_ID: Record<TtsEngine, string> = {
  kokoro: 'kokoro-af',
};

/**
 * Resolve the voice ID for a synthesis request.
 * When the filler engine (kokoro) is different from the configured engine,
 * use the filler engine's default voice — not the main engine's voice ID.
 * Otherwise Kokoro would try to load e.g. a non-Kokoro voice file and fail.
 */
function resolveVoiceId(
  engine: TtsEngine,
  configuredEngine: TtsEngine,
  configuredVoiceId: string | undefined,
  overrideVoiceId: string | undefined,
): string | undefined {
  if (overrideVoiceId) return overrideVoiceId;
  if (engine !== configuredEngine) return DEFAULT_VOICE_ID[engine];
  return configuredVoiceId ?? DEFAULT_VOICE_ID[engine];
}

export class VoiceService {
  private config: VoiceConfig;
  private readonly dataDir: string;
  private readonly sidecar: VoiceSidecarManager;
  private readonly sessions = new Map<string, VoiceSession>();
  private readonly fillerCache: FillerCache;
  private speakerService?: SpeakerService;
  private modelsWarmed = false;
  private warmedConfigKey = '';
  private idleUnloadTimer: ReturnType<typeof setTimeout> | null = null;
  private startPromise: Promise<void> | null = null;
  private pendingIdleUnload = false;

  constructor(options: VoiceServiceOptions) {
    this.dataDir = resolve(options.dataDir);
    this.config = mergeVoiceConfig(options.config);
    this.sidecar = options.sidecar ?? new VoiceSidecarManager({
      dataDir: this.voiceDataDir,
      pythonExecutable: options.pythonExecutable,
      env: options.sidecarEnv,
    });
    this.fillerCache = new FillerCache({ dataDir: this.dataDir, config: this.config });
  }

  updateConfig(config?: VoiceConfig): void {
    this.config = mergeVoiceConfig(config);
  }

  getConfig(): VoiceConfig {
    return this.config;
  }

  get voiceDataDir(): string {
    return join(this.dataDir, 'voice');
  }

  get tempDir(): string {
    return join(this.voiceDataDir, 'tmp');
  }

  async start(): Promise<void> {
    if (!this.config.enabled) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.runStart().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async runStart(): Promise<void> {
    this.cancelIdleUnload();
    this.pendingIdleUnload = false;
    await cleanupVoiceTempDir(this.voiceDataDir);
    const client = await this.sidecar.start();
    const configKey = this.warmConfigKey();
    let needsWarm = !this.modelsWarmed || this.warmedConfigKey !== configKey;
    if (!needsWarm) {
      try {
        const health = await client.health(2_000);
        needsWarm = !health.ok || health.state !== 'ready'
          || !health.models?.sttLoaded
          || !health.models?.ttsLoaded;
      } catch {
        needsWarm = true;
      }
    }
    if (needsWarm) {
      await client.warm({
        sttModelId: this.config.stt?.modelId,
        sttComputeType: this.config.stt?.computeType,
        sttDevice: this.config.stt?.device,
        ttsEngine: this.config.tts?.engine,
        ttsVoiceId: this.config.tts?.voiceId,
      });
      this.modelsWarmed = true;
      this.warmedConfigKey = configKey;
    }
    if (!this.speakerService) {
      this.speakerService = new SpeakerService(client);
    }
    if (this.pendingIdleUnload) {
      this.pendingIdleUnload = false;
      this.scheduleIdleUnloadIfIdle();
    }
  }

  getSpeakerService(): SpeakerService | undefined {
    return this.speakerService;
  }

  async getRootSpeaker(): Promise<VoiceSessionSpeaker | null> {
    if (!this.speakerService) {
      return null;
    }
    const root = await this.speakerService.getRoot().catch(() => null);
    if (!root) {
      return { id: null, name: 'Root', isRoot: true, recognized: true, confidence: null };
    }
    return {
      id: root.id ?? null,
      name: root.name ?? 'Root',
      isRoot: true,
      recognized: true,
      confidence: null,
    };
  }

  async resetSpeakers(): Promise<boolean> {
    if (!this.speakerService) return false;
    return this.speakerService.clear();
  }

  async updateSpeaker(profileId: string, name: string): Promise<SpeakerProfile | null> {
    if (!this.speakerService) return null;
    return this.speakerService.update(profileId, name);
  }

  async deleteSpeakerSample(profileId: string, sampleId: string): Promise<boolean> {
    if (!this.speakerService) return false;
    return this.speakerService.deleteSample(profileId, sampleId);
  }

  async identifySpeaker(pcm: Buffer, sampleRate = 16_000, threshold?: number): Promise<SpeakerIdentificationResult> {
    if (!this.speakerService) {
      return { speakerId: null, confidence: null, recognized: false, isRoot: false, rootName: null, available: false };
    }
    try {
      const t0 = Date.now();
      const effectiveThreshold = threshold ?? this.config.speaker?.identifyThreshold ?? 0.55;
      const result = await this.speakerService.identify(pcm, sampleRate, effectiveThreshold);
      getLogger().info('VOICE', `Speaker identification latency: ${Date.now() - t0}ms (pcm=${pcm.length} bytes)`);
      return result;
    } catch (err) {
      getLogger().warn('VOICE', `Speaker identification unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return { speakerId: null, confidence: null, recognized: false, isRoot: false, rootName: null, available: false };
    }
  }

  private warmConfigKey(): string {
    return JSON.stringify({
      sttModelId: this.config.stt?.modelId,
      sttComputeType: this.config.stt?.computeType,
      sttDevice: this.config.stt?.device,
      ttsEngine: this.config.tts?.engine,
      ttsVoiceId: this.config.tts?.voiceId,
    });
  }

  async stop(): Promise<void> {
    this.pendingIdleUnload = false;
    this.cancelIdleUnload();
    for (const session of this.sessions.values()) {
      session.close();
    }
    this.sessions.clear();
    await this.sidecar.stop();
    this.modelsWarmed = false;
    this.warmedConfigKey = '';
  }

  /** Release the sidecar after idle minutes when no voice sessions are active. */
  scheduleIdleUnloadIfIdle(): void {
    if (this.config.sidecar?.autoStart === true) return;
    if (this.sessions.size > 0) return;
    const minutes = this.config.sidecar?.idleUnloadMinutes ?? 5;
    if (minutes <= 0) return;
    this.cancelIdleUnload();
    const delayMs = minutes * 60_000;
    this.idleUnloadTimer = setTimeout(() => {
      this.idleUnloadTimer = null;
      if (this.sessions.size > 0) return;
      void this.stop().catch(() => {});
    }, delayMs);
  }

  isSidecarReady(): boolean {
    return this.sidecar.getStatus().state === 'ready';
  }

  /** Request unload when UI closes — never interrupts an in-flight start. */
  requestIdleUnload(): void {
    if (this.config.sidecar?.autoStart === true) return;
    if (this.sessions.size > 0) return;
    if (this.startPromise) {
      this.pendingIdleUnload = true;
      return;
    }
    if (!this.isSidecarReady()) return;
    this.scheduleIdleUnloadIfIdle();
  }

  private cancelIdleUnload(): void {
    if (this.idleUnloadTimer) {
      clearTimeout(this.idleUnloadTimer);
      this.idleUnloadTimer = null;
    }
  }

  createSession(options: Omit<ConstructorParameters<typeof VoiceSession>[0], 'sessionId'> & { sessionId?: string }): VoiceSession {
    if (this.sessions.size >= VOICE_LIMITS.maxConcurrentSessions) {
      throw new Error('Maximum concurrent voice sessions reached');
    }
    const session = new VoiceSession({
      ...options,
      sessionId: options.sessionId ?? randomUUID(),
    });
    this.sessions.set(session.sessionId, session);
    return session;
  }

  getSession(sessionId: string): VoiceSession | undefined {
    return this.sessions.get(sessionId);
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    session?.close();
    this.sessions.delete(sessionId);
    if (this.sessions.size === 0) {
      this.scheduleIdleUnloadIfIdle();
    }
  }

  createProgressSession(
    onSpeak: (text: string) => Promise<void>,
    options?: { transcript?: string },
  ): VoiceProgressSession {
    const transcript = options?.transcript?.trim() ?? '';
    const skipInitialAck = transcript.length > 0 && !shouldSpeakVoiceAckFiller(transcript);
    return new VoiceProgressSession({
      enabled: this.config.fillers?.enabled,
      speakToolProgress: this.config.fillers?.speakToolProgress,
      skipInitialAck,
      onSpeak: async (text) => onSpeak(text),
    });
  }

  async transcribeAudioFile(inputPath: string, options: VoiceTranscribeFileOptions = {}): Promise<VoiceSidecarTranscribeResponse> {
    const tempRoot = await this.createTempDir();
    const wavPath = join(tempRoot, `${basename(inputPath, extname(inputPath)) || 'audio'}.wav`);
    try {
      await convertOggToWav16kMono(inputPath, wavPath, { voiceTempDir: tempRoot, timeoutMs: 120_000 });
      const client = await this.sidecar.start();
      const result = await client.transcribe({
        audioPath: wavPath,
        modelId: this.config.stt?.modelId,
        language: options.language,
      });
      if (!result.text?.trim()) {
        return { ...result, text: '' };
      }
      return result;
    } finally {
      if (!options.keepTemp) {
        await rm(tempRoot, { recursive: true, force: true });
      }
    }
  }

  async transcribePcmBuffer(pcm: Buffer, sampleRate = 16_000): Promise<VoiceSidecarTranscribeResponse> {
    const client = await this.sidecar.start();
    const result = await client.transcribePcm(pcm, sampleRate, { modelId: this.config.stt?.modelId });
    return result.text?.trim() ? result : { ...result, text: '' };
  }

  async streamTranscribeChunk(
    pcm: Buffer,
    sampleRate: number,
    options: { reset?: boolean; finalize?: boolean; preview?: boolean } = {},
  ) {
    const client = await this.sidecar.start();
    return client.streamTranscribe({
      pcmBase64: pcm.length > 0 ? pcm.toString('base64') : undefined,
      sampleRate,
      reset: options.reset,
      finalize: options.finalize,
      preview: options.preview,
      modelId: this.config.stt?.modelId,
    });
  }

  /**
   * Merged reset+finalize in a single HTTP call (Fix #1).
   * Sends the PCM with both reset=true and finalize=true so the sidecar
   * clears its stream buffer, appends the new PCM, and transcribes in one pass.
   */
  async streamTranscribeFinalize(pcm: Buffer, sampleRate: number) {
    const client = await this.sidecar.start();
    return client.streamTranscribe({
      pcmBase64: pcm.length > 0 ? pcm.toString('base64') : undefined,
      sampleRate,
      reset: true,
      finalize: true,
      modelId: this.config.stt?.modelId,
    });
  }

  /** Incremental VAD on a mic chunk — used for duplex end-of-utterance. */
  async detectVad(
    pcm: Buffer,
    sampleRate = 16_000,
    options: { threshold?: number; reset?: boolean } = {},
  ) {
    const client = await this.sidecar.start();
    return client.detectVad(pcm, sampleRate, options);
  }

  /**
   * Stream TTS audio chunks as they are synthesized (Fix #6/#7/#8).
   * Returns an async iterator + requestId so the caller can start playing
   * the first chunk while later sentences are still being synthesized.
   */
  async synthesizeStreamText(text: string, options: VoiceSynthesizeOptions = {}): Promise<VoiceStreamSynthesizeResult> {
    const normalized = normalizeTextForSpeech(text);
    if (!normalized) throw new Error('Nothing to synthesize after speech normalization');
    const client = await this.sidecar.start();
    const configuredEngine = this.config.tts?.engine ?? 'kokoro';
    const engine = options.forFiller
      ? (this.config.tts?.fillerEngine ?? 'kokoro')
      : (options.engine ?? configuredEngine);
    const voiceId = resolveVoiceId(
      engine,
      configuredEngine,
      this.config.tts?.voiceId,
      options.voiceId,
    );
    const requestId = options.requestId ?? randomUUID();
    const chunkStream = client.synthesizeStreamNd({
      text: normalized,
      engine,
      voiceId,
      style: options.style ?? this.config.tts?.style,
      requestId,
    });
    return { chunks: chunkStream, requestId };
  }

  async warmFillerCache(): Promise<void> {
    if (!this.config.fillers?.enabled) return;
    const tmpRoot = await this.createTempDir();
    try {
      for (const phrase of this.fillerCache.listPhrasesToWarm()) {
        const cached = await this.fillerCache.getCachedPath(phrase);
        if (cached) continue;
        const out = join(tmpRoot, `filler-${phrase.length}.wav`);
        await this.synthesizeFiller(phrase, out);
      }
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  }

  async synthesizeText(text: string, outputPath: string, options: VoiceSynthesizeOptions = {}): Promise<VoiceSidecarSynthesizeResponse> {
    const normalized = normalizeTextForSpeech(text);
    if (!normalized) {
      throw new Error('Nothing to synthesize after speech normalization');
    }
    await mkdir(dirname(outputPath), { recursive: true });
    const client = await this.sidecar.start();
    const configuredEngine = this.config.tts?.engine ?? 'kokoro';
    const engine = options.forFiller
      ? (this.config.tts?.fillerEngine ?? 'kokoro')
      : (options.engine ?? configuredEngine);
    const voiceId = resolveVoiceId(
      engine,
      configuredEngine,
      this.config.tts?.voiceId,
      options.voiceId,
    );
    return client.synthesize({
      text: normalized,
      engine,
      voiceId,
      style: options.style ?? this.config.tts?.style,
      outputPath,
    });
  }

  async synthesizeFiller(text: string, outputPath: string): Promise<VoiceSidecarSynthesizeResponse> {
    const cached = await this.fillerCache.getCachedPath(text);
    if (cached) {
      const audio = await readFile(cached);
      await writeFile(outputPath, audio);
      return { audioPath: outputPath, sampleRate: 24_000 };
    }
    const result = await this.synthesizeText(text, outputPath, { forFiller: true });
    if (result.audioPath) {
      const audio = await readFile(result.audioPath);
      await this.fillerCache.store(text, audio);
    }
    return result;
  }

  getSidecarManager(): VoiceSidecarManager {
    return this.sidecar;
  }

  private async createTempDir(): Promise<string> {
    await mkdir(this.tempDir, { recursive: true });
    return mkdtemp(join(this.tempDir, 'turn-'));
  }
}
