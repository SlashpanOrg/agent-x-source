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
/**
 * While xAI duplex TTS is playing, only forward mic frames at/above this level.
 * Blocks soft speaker bleed from tripping server VAD barge-in; real talk is louder.
 */
export const XAI_BARGE_IN_MIC_LEVEL = 0.05;
/**
 * Client-side barge-in trigger: during xAI duplex playback, only sustained
 * mic energy at or above this level stops playback and switches to listening.
 * Set above the forward gate so only clear, deliberate user speech triggers it,
 * not residual echo, ambient noise, coughs, claps, notification sounds, or pen drops.
 */
export const XAI_BARGE_IN_TRIGGER_LEVEL = 0.18;
/**
 * Number of consecutive mic frames that must exceed XAI_BARGE_IN_TRIGGER_LEVEL
 * before a client-side barge-in is declared. At ~5ms per AudioWorklet frame,
 * 8 frames ≈ 40ms of sustained speech — long enough to filter out claps, coughs,
 * notification sounds, and dropped objects, but short enough to feel instant for real words.
 */
export const XAI_BARGE_IN_TRIGGER_FRAMES = 8;
