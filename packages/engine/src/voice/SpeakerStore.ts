import type { SpeakerProfile } from '@agentx/shared';
import type { VoiceSidecarClient } from './sidecar/VoiceSidecarClient.js';

/**
 * Stores and manages speaker voiceprint profiles.
 *
 * The engine-side store is a thin wrapper over the sidecar's on-disk JSONL
 * store. All heavy lifting (extraction, comparison, persistence) runs in the
 * sidecar so the model and embeddings stay together.
 */
export interface SpeakerMatch {
  speakerId?: string | null;
  speakerName?: string | null;
  confidence?: number | null;
  isRoot?: boolean;
}

export interface SpeakerIdentificationResult {
  speakerId?: string | null;
  speakerName?: string | null;
  confidence?: number | null;
  recognized: boolean;
  isRoot: boolean;
  rootName?: string | null;
  matches?: SpeakerMatch[];
  available: boolean;
}

export class SpeakerStore {
  constructor(private readonly client: VoiceSidecarClient) {}

  async list(): Promise<SpeakerProfile[]> {
    const res = await this.client.speakerList();
    return (res.profiles ?? []).map((p) => this.normalize(p));
  }

  async add(name: string, pcm: Buffer, sampleRate = 16_000, isRoot = false, profileId?: string): Promise<SpeakerProfile> {
    const res = await this.client.speakerEnroll({
      name,
      pcm: pcm.toString('base64'),
      sampleRate,
      isRoot,
      profileId,
    });
    return this.normalize(res.profile);
  }

  async addSample(profileId: string, pcm: Buffer, sampleRate = 16_000): Promise<SpeakerProfile> {
    const res = await this.client.speakerEnroll({
      name: '',
      pcm: pcm.toString('base64'),
      sampleRate,
      isRoot: false,
      profileId,
    });
    return this.normalize(res.profile);
  }

  async deleteSample(profileId: string, sampleId: string): Promise<boolean> {
    const res = await this.client.speakerDeleteSample({ profileId, sampleId });
    return res.ok;
  }

  async identify(pcm: Buffer, sampleRate = 16_000, threshold = 0.25): Promise<SpeakerIdentificationResult> {
    const res = await this.client.speakerIdentify({
      pcm: pcm.toString('base64'),
      sampleRate,
      threshold,
    });
    const recognized = res.recognized ?? false;
    // Only return a match when the best score beats the configured threshold.
    // Below threshold we treat it as no recognition so the caller can fall back.
    return {
      speakerId: recognized ? (res.speakerId ?? null) : null,
      speakerName: recognized ? (res.speakerName ?? null) : null,
      confidence: recognized ? (res.confidence ?? null) : null,
      recognized,
      isRoot: recognized ? (res.isRoot ?? false) : false,
      rootName: res.rootName ?? null,
      matches: res.matches ?? [],
      available: true,
    };
  }

  async delete(profileId: string): Promise<boolean> {
    const res = await this.client.speakerDelete({ profileId });
    return res.ok;
  }

  async setRoot(profileId: string): Promise<SpeakerProfile | null> {
    const res = await this.client.speakerSetRoot({ profileId });
    return res.profile ? this.normalize(res.profile) : null;
  }

  async update(profileId: string, name: string): Promise<SpeakerProfile | null> {
    const res = await this.client.speakerUpdate({ profileId, name });
    return res.profile ? this.normalize(res.profile) : null;
  }

  async getRoot(): Promise<SpeakerProfile | null> {
    const profiles = await this.list();
    return profiles.find((p) => p.isRoot) ?? profiles[0] ?? null;
  }

  async clear(): Promise<boolean> {
    const profiles = await this.list();
    await Promise.all(profiles.map((p) => this.delete(p.id)));
    return true;
  }

  private normalize(p: { id: string; name: string; isRoot?: boolean; embedding?: number[]; sampleB64?: string; createdAt?: string | null }): SpeakerProfile {
    const now = new Date().toISOString();
    return {
      id: p.id,
      name: p.name,
      isRoot: p.isRoot ?? false,
      embedding: p.embedding,
      sampleB64: p.sampleB64,
      createdAt: p.createdAt ? String(p.createdAt) : now,
      updatedAt: p.createdAt ? String(p.createdAt) : now,
    };
  }
}
