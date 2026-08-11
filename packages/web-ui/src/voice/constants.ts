export const VOICE_MIC_PREPROMPT_KEY = 'agentx_voice_mic_preprompt_seen_v1';
export const VOICE_ONBOARDING_KEY = 'agentx_voice_onboarding_dismissed_v1';
export const VOICE_OUTPUT_UNLOCKED_KEY = 'agentx_voice_output_unlocked_v1';
export const VOICE_MAX_TURN_SECONDS = 60;
export const VOICE_TURN_COUNTDOWN_FROM_SECONDS = 45;
/** Ignore very brief Space taps (mis-click). */
export const VOICE_ACCIDENTAL_TAP_MS = 140;
/** Minimum hold when no speech energy was detected. */
export const VOICE_MIN_RECORDING_MS = 220;
/** Peak mic level (0–1) that counts as speech for short clips. */
export const VOICE_MIN_SPEECH_LEVEL = 0.055;

// Duplex / barge-in / first-chunk params are shared with the server and call sessions.
export {
  XAI_BARGE_IN_MIC_LEVEL,
  XAI_BARGE_IN_TRIGGER_LEVEL,
  XAI_BARGE_IN_TRIGGER_FRAMES,
  XAI_WAKE_BARGE_IN_TRIGGER_LEVEL,
  XAI_WAKE_BARGE_IN_TRIGGER_FRAMES,
  XAI_BARGE_IN_PLAYBACK_GRACE_MS,
  MIN_FIRST_PLAYBACK_SAMPLES,
  FIRST_PLAYBACK_START_DELAY_SEC,
  PLAYBACK_IDLE_NOTIFY_MS,
  VOICE_INPUT_SAMPLE_RATE,
  VOICE_OUTPUT_SAMPLE_RATE,
} from '@agentx/shared/browser';
