import type {
  VoiceSidecarCancelRequest,
  VoiceSidecarHealth,
  VoiceSidecarStreamSynthesizeRequest,
  VoiceSidecarStreamAudioChunk,
  VoiceSidecarStreamSynthesizeResponse,
  VoiceSidecarStreamTranscribeRequest,
  VoiceSidecarStreamTranscribeResponse,
  VoiceSidecarSynthesizeRequest,
  VoiceSidecarSynthesizeResponse,
  VoiceSidecarTranscribeRequest,
  VoiceSidecarTranscribeResponse,
  VoiceSidecarVadDetectResponse,
  VoiceSidecarWarmRequest,
} from './VoiceSidecarProtocol.js';
import { getLogger } from '@agentx/shared';

export interface VoiceSidecarClientOptions {
  baseUrl: string;
  authToken: string;
  timeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export class VoiceSidecarClient {
  private readonly baseUrl: string;
  private readonly authToken: string;
  private readonly timeoutMs: number;

  constructor(options: VoiceSidecarClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.authToken = options.authToken;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  health(timeoutMs = 2_000): Promise<VoiceSidecarHealth> {
    return this.request<VoiceSidecarHealth>('GET', '/health', undefined, timeoutMs);
  }

  warm(request: VoiceSidecarWarmRequest): Promise<VoiceSidecarHealth> {
    return this.request<VoiceSidecarHealth>('POST', '/warm', request, 120_000);
  }

  transcribe(request: VoiceSidecarTranscribeRequest): Promise<VoiceSidecarTranscribeResponse> {
    return this.request<VoiceSidecarTranscribeResponse>('POST', '/stt/transcribe', request, this.timeoutMs);
  }

  transcribePcm(pcm: Buffer, sampleRate = 16_000, options: Omit<VoiceSidecarTranscribeRequest, 'audioPath'> = {}): Promise<VoiceSidecarTranscribeResponse> {
    const query = this.buildBinaryQuery({ sampleRate, modelId: options.modelId, language: options.language });
    return this.requestBinary<VoiceSidecarTranscribeResponse>('POST', `/stt/transcribe?${query}`, pcm, this.timeoutMs);
  }

  streamTranscribe(request: VoiceSidecarStreamTranscribeRequest): Promise<VoiceSidecarStreamTranscribeResponse> {
    if (request.pcmBase64) {
      const pcm = Buffer.from(request.pcmBase64, 'base64');
      const query = this.buildBinaryQuery({
        sampleRate: request.sampleRate,
        modelId: request.modelId,
        language: request.language,
        reset: request.reset,
        finalize: request.finalize,
        preview: request.preview,
      });
      return this.requestBinary<VoiceSidecarStreamTranscribeResponse>('POST', `/stt/stream?${query}`, pcm, this.timeoutMs);
    }
    const { pcmBase64: _pcmBase64, ...rest } = request;
    return this.request<VoiceSidecarStreamTranscribeResponse>('POST', '/stt/stream', rest, this.timeoutMs);
  }

  synthesize(request: VoiceSidecarSynthesizeRequest): Promise<VoiceSidecarSynthesizeResponse> {
    return this.request<VoiceSidecarSynthesizeResponse>('POST', '/tts/synthesize', request, this.timeoutMs);
  }

  /**
   * Stream TTS audio chunks via NDJSON chunked transfer encoding.
   * Returns an async iterator that yields chunks as they arrive from the sidecar,
   * instead of waiting for all chunks to be synthesized. (Fix #6/#7)
   */
  async *synthesizeStreamNd(request: VoiceSidecarStreamSynthesizeRequest, timeoutMs = this.timeoutMs): AsyncGenerator<VoiceSidecarStreamAudioChunk> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/tts/stream`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.authToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        let payload: any;
        try { payload = text.length > 0 ? JSON.parse(text) : undefined; } catch { payload = undefined; }
        const message = typeof payload?.error === 'string' ? payload.error : `Voice sidecar TTS stream failed: ${response.status}`;
        throw new Error(message);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('Response body is not readable');

      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            yield JSON.parse(trimmed) as VoiceSidecarStreamAudioChunk;
          } catch {
            // Partial line — will be completed on next read
          }
        }
      }

      const tail = buffer.trim();
      if (tail) {
        try { yield JSON.parse(tail) as VoiceSidecarStreamAudioChunk; } catch { /* ignore */ }
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Legacy: collect all TTS chunks into a single response.
   * Prefer synthesizeStreamNd for streaming — this is kept for backward compat.
   */
  async synthesizeStream(request: VoiceSidecarStreamSynthesizeRequest): Promise<VoiceSidecarStreamSynthesizeResponse> {
    const chunks: VoiceSidecarStreamAudioChunk[] = [];
    for await (const chunk of this.synthesizeStreamNd(request)) {
      chunks.push(chunk);
    }
    return { chunks };
  }

  async cancel(request: VoiceSidecarCancelRequest): Promise<void> {
    await this.request<{ ok: boolean }>('POST', '/cancel', request, 5_000);
  }

  detectVad(
    pcm: Buffer,
    sampleRate = 16_000,
    options: { threshold?: number; reset?: boolean } = {},
  ): Promise<VoiceSidecarVadDetectResponse> {
    return this.request<VoiceSidecarVadDetectResponse>('POST', '/vad/detect', {
      pcm: pcm.toString('base64'),
      sampleRate,
      threshold: options.threshold,
      reset: options.reset,
    }, 5_000);
  }

  private buildBinaryQuery(params: Record<string, unknown>): string {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      if (typeof value === 'boolean') {
        if (value) parts.push(`${key}=true`);
      } else {
        parts.push(`${key}=${encodeURIComponent(String(value))}`);
      }
    }
    return parts.join('&');
  }

  private async requestBinary<T>(method: 'GET' | 'POST', path: string, body: Buffer, timeoutMs = this.timeoutMs): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.authToken}`,
          'content-type': 'application/octet-stream',
        },
        body: body.length > 0 ? body : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      let payload: any;
      try {
        payload = text.length > 0 ? JSON.parse(text) : undefined;
      } catch (error) {
        getLogger().warn('VOICE_SIDECAR_CLIENT', `Failed to parse sidecar response: ${error instanceof Error ? error.message : String(error)}`);
        payload = undefined;
      }

      if (!response.ok) {
        const message = typeof payload?.error === 'string' ? payload.error : `Voice sidecar request failed: ${response.status}`;
        throw new Error(message);
      }

      return payload as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.authToken}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await response.text();
      let payload: any;
      try {
        payload = text.length > 0 ? JSON.parse(text) : undefined;
      } catch (error) {
        getLogger().warn('VOICE_SIDECAR_CLIENT', `Failed to parse sidecar response: ${error instanceof Error ? error.message : String(error)}`);
        payload = undefined;
      }

      if (!response.ok) {
        const message = typeof payload?.error === 'string' ? payload.error : `Voice sidecar request failed: ${response.status}`;
        throw new Error(message);
      }

      return payload as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
