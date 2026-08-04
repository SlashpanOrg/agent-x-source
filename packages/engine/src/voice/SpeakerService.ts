import type { SpeakerProfile } from '@agentx/shared';
import type { VoiceSidecarClient } from './sidecar/VoiceSidecarClient.js';
import { SpeakerStore, type SpeakerIdentificationResult } from './SpeakerStore.js';

/**
 * Engine-agnostic speaker identification service.
 *
 * Wraps the sidecar-backed `SpeakerStore` and provides the identify/enroll/list
 * surface used by both the local `stt_llm_tts` pipeline and the xAI realtime
 * pipeline. Heavy work (embedding extraction, cosine search) stays in the sidecar.
 */
export class SpeakerService {
  private readonly store: SpeakerStore;

  constructor(client: VoiceSidecarClient) {
    this.store = new SpeakerStore(client);
  }

  list(): Promise<SpeakerProfile[]> {
    return this.store.list();
  }

  add(name: string, pcm: Buffer, sampleRate = 16_000, isRoot = false, profileId?: string): Promise<SpeakerProfile> {
    return this.store.add(name, pcm, sampleRate, isRoot, profileId);
  }

  addSample(profileId: string, pcm: Buffer, sampleRate = 16_000): Promise<SpeakerProfile> {
    return this.store.addSample(profileId, pcm, sampleRate);
  }

  deleteSample(profileId: string, sampleId: string): Promise<boolean> {
    return this.store.deleteSample(profileId, sampleId);
  }

  identify(pcm: Buffer, sampleRate = 16_000, threshold = 0.25): Promise<SpeakerIdentificationResult> {
    return this.store.identify(pcm, sampleRate, threshold);
  }

  delete(profileId: string): Promise<boolean> {
    return this.store.delete(profileId);
  }

  setRoot(profileId: string): Promise<SpeakerProfile | null> {
    return this.store.setRoot(profileId);
  }

  update(profileId: string, name: string): Promise<SpeakerProfile | null> {
    return this.store.update(profileId, name);
  }

  getRoot(): Promise<SpeakerProfile | null> {
    return this.store.getRoot();
  }

  clear(): Promise<boolean> {
    return this.store.clear();
  }
}
