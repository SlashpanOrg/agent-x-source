import {
  FIRST_PLAYBACK_START_DELAY_SEC,
  MIN_FIRST_PLAYBACK_SAMPLES,
  PLAYBACK_IDLE_NOTIFY_MS,
  VOICE_OUTPUT_SAMPLE_RATE,
} from '@agentx/shared/browser';
import { int16ToFloat32, mergeInt16Chunks } from './pcm.js';

export class StreamingPlayback {
  private context: AudioContext | null = null;
  private activeSources: AudioBufferSourceNode[] = [];
  private nextStartTime = 0;
  private readonly defaultSampleRate: number;
  private lastChunks: Array<{ pcm: Int16Array; sampleRate: number }> = [];
  private primingChunks: Int16Array[] = [];
  private primingSampleCount = 0;

  constructor(defaultSampleRate = VOICE_OUTPUT_SAMPLE_RATE) {
    this.defaultSampleRate = defaultSampleRate;
  }

  async ensureContext(): Promise<AudioContext> {
    if (!this.context) {
      this.context = new AudioContext();
      this.nextStartTime = this.context.currentTime;
    }
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
    return this.context;
  }

  async enqueuePcm(pcm: Int16Array, sampleRate = this.defaultSampleRate): Promise<void> {
    this.lastChunks.push({ pcm, sampleRate });
    let playPcm = pcm;
    if (this.activeSources.length === 0) {
      this.primingChunks.push(pcm);
      this.primingSampleCount += pcm.length;
      if (this.primingSampleCount < MIN_FIRST_PLAYBACK_SAMPLES) return;
      playPcm = mergeInt16Chunks(this.primingChunks);
      this.primingChunks = [];
      this.primingSampleCount = 0;
    }
    await this.playPcm(playPcm, sampleRate);
  }

  /** Play leftover priming audio that never reached MIN_FIRST_PLAYBACK_SAMPLES (short announces). */
  async flushPriming(): Promise<void> {
    if (this.primingSampleCount === 0 || this.primingChunks.length === 0) return;
    const playPcm = mergeInt16Chunks(this.primingChunks);
    this.primingChunks = [];
    this.primingSampleCount = 0;
    await this.playPcm(playPcm, this.defaultSampleRate);
  }

  private async playPcm(playPcm: Int16Array, sampleRate: number): Promise<void> {
    const ctx = await this.ensureContext();
    const floats = int16ToFloat32(playPcm);
    const channel = new Float32Array(floats);
    const buffer = ctx.createBuffer(1, channel.length, sampleRate);
    buffer.copyToChannel(channel, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startAt = this.activeSources.length === 0
      ? ctx.currentTime + FIRST_PLAYBACK_START_DELAY_SEC
      : Math.max(ctx.currentTime, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;
    this.activeSources.push(source);
    source.onended = () => {
      this.activeSources = this.activeSources.filter((s) => s !== source);
      this.scheduleIdleNotify();
    };
  }

  private onIdle: (() => void) | null = null;
  private notifyIdleScheduled = false;

  setOnIdle(handler: (() => void) | null): void {
    this.onIdle = handler;
  }

  private scheduleIdleNotify(): void {
    if (!this.onIdle || this.activeSources.length > 0 || this.notifyIdleScheduled) return;
    this.notifyIdleScheduled = true;
    // Wait after the final audio chunk before declaring playback idle.
    // This prevents the UI from snapping to "listening" before the last word.
    window.setTimeout(() => {
      this.notifyIdleScheduled = false;
      if (this.activeSources.length === 0) {
        this.onIdle?.();
      }
    }, PLAYBACK_IDLE_NOTIFY_MS);
  }

  stop(): void {
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // ignore
      }
    }
    this.activeSources = [];
    this.primingChunks = [];
    this.primingSampleCount = 0;
    if (this.context) {
      this.nextStartTime = this.context.currentTime;
    }
    this.scheduleIdleNotify();
  }

  async replayLast(): Promise<void> {
    if (this.lastChunks.length === 0) return;
    this.stop();
    for (const chunk of this.lastChunks) {
      await this.enqueuePcm(chunk.pcm, chunk.sampleRate);
    }
  }

  clearHistory(): void {
    this.lastChunks = [];
  }

  get playing(): boolean {
    return this.activeSources.length > 0;
  }

  async close(): Promise<void> {
    this.stop();
    this.clearHistory();
    await this.context?.close();
    this.context = null;
    this.nextStartTime = 0;
  }
}

export function decodeBinaryAudioChunk(data: ArrayBuffer): Int16Array {
  return new Int16Array(data);
}
