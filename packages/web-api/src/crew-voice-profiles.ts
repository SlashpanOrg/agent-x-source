/**
 * Per-crew persistent voice profile store.
 *
 * On the first voice call to a crew, a stable voice profile is randomly
 * assigned from both the local (Kokoro) and xAI voice catalogs. The
 * assignment is persisted to <dataDir>/crew-voice-profiles.json keyed by
 * crew callsign and never changes after first write — this gives each crew
 * member a consistent "voice identity" across calls and across engine
 * switches, so they feel like the same real person.
 */
import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { getDataDir, getLogger } from '@agentx/shared';

/** Kokoro voice IDs available in the bundled voices-v1.0.bin asset. */
const KOKORO_VOICE_IDS: readonly string[] = [
  // American English
  'kokoro-af', 'af_bella', 'af_nicole', 'af_sarah', 'af_aoede', 'af_kore',
  'af_alloy', 'af_nova', 'af_sky', 'af_jessica', 'af_river',
  'am_michael', 'am_fenrir', 'am_puck', 'am_eric', 'am_echo', 'am_liam',
  'am_onyx', 'am_adam', 'am_santa',
  // British English
  'bf_emma', 'bf_isabella', 'bf_alice', 'bf_lily',
  'bm_george', 'bm_fable', 'bm_lewis', 'bm_daniel',
  // Japanese
  'jf_alpha', 'jf_gongitsune', 'jf_tebukuro', 'jf_nezumi', 'jm_kumo',
  // Mandarin Chinese
  'zf_xiaobei', 'zf_xiaoni', 'zf_xiaoxiao', 'zf_xiaoyi',
  'zm_yunjian', 'zm_yunxi', 'zm_yunxia', 'zm_yunyang',
  // Spanish
  'ef_dora', 'em_alex', 'em_santa',
  // French
  'ff_siwis',
  // Hindi
  'hf_alpha', 'hf_beta', 'hm_omega', 'hm_psi',
  // Italian
  'if_sara', 'im_nicola',
  // Brazilian Portuguese
  'pf_dora', 'pm_alex', 'pm_santa',
] as const;

/**
 * Known xAI voice IDs used as a fallback when the live /v1/tts/voices
 * endpoint cannot be reached (e.g. xAI not configured yet). The live list
 * is always preferred when available.
 */
const XAI_FALLBACK_VOICE_IDS: readonly string[] = [
  'eve', 'sol', 'lily', 'aria', 'nova', 'shimmer', 'onyx', 'alloy',
] as const;

export interface CrewVoiceProfile {
  /** Kokoro voice ID for the local STT/LLM/TTS engine. */
  local: string;
  /** xAI voice ID for the realtime_xai engine. */
  xAI: string;
}

type ProfileMap = Record<string, CrewVoiceProfile>;

function profileFilePath(): string {
  return join(getDataDir(), 'crew-voice-profiles.json');
}

function readProfileMap(): ProfileMap {
  try {
    const path = profileFilePath();
    if (!existsSync(path)) return {};
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as ProfileMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    getLogger().warn('CREW_VOICE_PROFILE', `Failed to read profiles: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}

function writeProfileMap(map: ProfileMap): void {
  try {
    const path = profileFilePath();
    const dir = join(path, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(map, null, 2), 'utf-8');
  } catch (err) {
    getLogger().error('CREW_VOICE_PROFILE', `Failed to write profiles: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function pickRandom<T>(items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * Fetch the live xAI voice list. Returns the fallback list on any error
 * (xAI not configured, network failure, etc.).
 */
async function fetchXaiVoiceIds(apiKey?: string): Promise<readonly string[]> {
  if (!apiKey) return XAI_FALLBACK_VOICE_IDS;
  try {
    const response = await fetch('https://api.x.ai/v1/tts/voices', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return XAI_FALLBACK_VOICE_IDS;
    const data = await response.json() as { voices?: Array<{ voice_id?: string }> };
    const ids = (data.voices ?? [])
      .map((v) => v.voice_id)
      .filter((id): id is string => Boolean(id));
    return ids.length > 0 ? ids : XAI_FALLBACK_VOICE_IDS;
  } catch {
    return XAI_FALLBACK_VOICE_IDS;
  }
}

/**
 * Return the existing voice profile for a crew callsign, or create one
 * (random pick from both engines) and persist it. Once written, the
 * profile for a callsign never changes.
 *
 * @param callsign Crew callsign (key in the JSON file).
 * @param xaiApiKey Optional xAI API key — when present, the live voice
 *                  list is fetched for a richer random pool. Falls back
 *                  to a hardcoded list otherwise.
 */
export async function getOrCreateCrewVoiceProfile(
  callsign: string,
  xaiApiKey?: string,
): Promise<CrewVoiceProfile> {
  const key = callsign.trim().toLowerCase();
  if (!key) throw new Error('callsign is required');

  const map = readProfileMap();
  const existing = map[key];
  if (existing && existing.local && existing.xAI) return existing;

  const localVoice = pickRandom(KOKORO_VOICE_IDS) ?? 'kokoro-af';
  const xaiVoices = await fetchXaiVoiceIds(xaiApiKey);
  const xaiVoice = pickRandom(xaiVoices) ?? 'eve';

  const profile: CrewVoiceProfile = { local: localVoice, xAI: xaiVoice };
  map[key] = profile;
  writeProfileMap(map);
  getLogger().info('CREW_VOICE_PROFILE', `Assigned voice profile for ${key}: local=${localVoice}, xAI=${xaiVoice}`);
  return profile;
}

/**
 * Read-only lookup — returns the existing profile or null. Does NOT create.
 * Used by voice-ws.ts to apply the override without triggering creation
 * (creation happens in postCrewChatVoiceSession on first call).
 */
export function getCrewVoiceProfile(callsign: string): CrewVoiceProfile | null {
  const key = callsign.trim().toLowerCase();
  if (!key) return null;
  const map = readProfileMap();
  const existing = map[key];
  return existing && existing.local && existing.xAI ? existing : null;
}
