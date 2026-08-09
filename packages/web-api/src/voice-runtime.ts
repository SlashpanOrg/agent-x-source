import { resolve } from 'node:path';
import { getDataDir } from '@agentx/shared';
import { VoiceService, mergeVoiceConfig } from '@agentx/engine';
import { getEngine } from './engine.js';
import { getVoiceSidecarManager } from './voice-api.js';

let voiceService: VoiceService | null = null;

/** Base data dir for VoiceService (it appends `/voice` for asset paths). */
function voiceServiceDataDir(): string {
  const envVoice = process.env['AGENTX_VOICE_DATA_DIR'];
  if (envVoice) {
    // When env points at the voice folder, VoiceService must use its parent.
    return resolve(envVoice, '..');
  }
  return getDataDir();
}

export function getVoiceService(): VoiceService {
  const loaded = getEngine().configManager.load();
  const callsign = loaded.user?.callsign?.trim();
  const cfg = mergeVoiceConfig({ ...loaded.voice, callsign });
  if (!voiceService) {
    voiceService = new VoiceService({
      dataDir: voiceServiceDataDir(),
      config: cfg,
      sidecar: getVoiceSidecarManager(),
    });
  } else {
    voiceService.updateConfig(cfg);
  }
  return voiceService;
}

export function resetVoiceService(): void {
  voiceService = null;
}
