import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceSidecarClient } from '../src/voice/sidecar/VoiceSidecarClient.js';

describe('VoiceSidecarClient', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true, text: 'hello' }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls health endpoint with bearer token', async () => {
    const client = new VoiceSidecarClient({ baseUrl: 'http://127.0.0.1:9876', authToken: 'secret' });
    await client.health();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/health',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer secret' }),
      }),
    );
  });

  it('streams transcription requests to /stt/stream with binary body', async () => {
    const client = new VoiceSidecarClient({ baseUrl: 'http://127.0.0.1:9876', authToken: 'secret' });
    await client.streamTranscribe({ pcmBase64: 'AA==', sampleRate: 16000, finalize: true });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('http://127.0.0.1:9876/stt/stream?'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'content-type': 'application/octet-stream' }),
      }),
    );
  });

  it('streams synthesis requests to /tts/stream via NDJSON', async () => {
    const ndjsonLine = JSON.stringify({ pcmBase64: 'AA==', sampleRate: 24000 }) + '\n';
    const encoder = new TextEncoder();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => {
          let read = false;
          return {
            read: async () => {
              if (read) return { done: true, value: undefined };
              read = true;
              return { done: false, value: encoder.encode(ndjsonLine) };
            },
          };
        },
      },
    });
    const client = new VoiceSidecarClient({ baseUrl: 'http://127.0.0.1:9876', authToken: 'secret' });
    const result = await client.synthesizeStream({ text: 'Hello', engine: 'kokoro', requestId: 'req-1' });
    expect(result.chunks).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/tts/stream',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('req-1'),
      }),
    );
  });

  it('surfaces sidecar errors', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      text: async () => JSON.stringify({ error: 'sidecar down' }),
    });
    const client = new VoiceSidecarClient({ baseUrl: 'http://127.0.0.1:9876', authToken: 'secret' });
    await expect(client.health()).rejects.toThrow('sidecar down');
  });
});
