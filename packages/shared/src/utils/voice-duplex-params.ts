/**
 * Shared duplex / xAI realtime audio params.
 * Dashboard voice and crew-call sessions must use the same values (client + server).
 */

/** Mic capture / uplink PCM rate. */
export const VOICE_INPUT_SAMPLE_RATE = 16_000;

/** Assistant TTS PCM rate from xAI realtime. */
export const VOICE_OUTPUT_SAMPLE_RATE = 24_000;

/**
 * While assistant TTS is playing, only forward mic frames at/above this level.
 * Blocks soft speaker bleed from tripping server VAD barge-in.
 */
export const XAI_BARGE_IN_MIC_LEVEL = 0.05;

/**
 * Client barge-in trigger during duplex playback — sustained mic energy gate.
 * Above the forward gate so only deliberate speech interrupts.
 */
export const XAI_BARGE_IN_TRIGGER_LEVEL = 0.22;

/**
 * Consecutive mic frames above XAI_BARGE_IN_TRIGGER_LEVEL before barge-in.
 * ~5ms/frame → 12 ≈ 60ms sustained speech.
 */
export const XAI_BARGE_IN_TRIGGER_FRAMES = 12;

/** Wake-word mode: slightly stricter client barge-in (always-open mic). */
export const XAI_WAKE_BARGE_IN_TRIGGER_LEVEL = 0.28;
export const XAI_WAKE_BARGE_IN_TRIGGER_FRAMES = 16;

/**
 * After assistant speech starts, ignore mic barge-in for this long (client + server).
 * Suppresses speaker echo / AEC settle on the first words of each turn.
 */
export const XAI_BARGE_IN_PLAYBACK_GRACE_MS = 1_000;

/**
 * Buffer this many output samples before starting playback (~300ms @ 24 kHz).
 * Avoids first-word jitter on both dashboard and call sessions.
 */
export const MIN_FIRST_PLAYBACK_SAMPLES = 7_200;

/** Extra delay before the first playback source starts (seconds). */
export const FIRST_PLAYBACK_START_DELAY_SEC = 0.12;

/** Idle notify after final TTS chunk drains (ms). */
export const PLAYBACK_IDLE_NOTIFY_MS = 400;

/** Server VAD (xAI turn_detection) — manual duplex. */
export const XAI_SERVER_VAD = {
  threshold: 0.45,
  prefix_padding_ms: 200,
  silence_duration_ms: 500,
} as const;

/** Server VAD when wake-word gating is enabled. */
export const XAI_WAKE_SERVER_VAD = {
  threshold: 0.35,
  prefix_padding_ms: 100,
  silence_duration_ms: 500,
} as const;

/** Skip persisting/emitting the same user transcript within this window. */
export const VOICE_USER_TRANSCRIPT_DEDUP_MS = 2_500;
