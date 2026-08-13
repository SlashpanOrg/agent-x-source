import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import { voice, personaApi } from '../../api';
import { getCoreSessionId } from '../../perf/api-cache';
import { useVoiceWarmup, type VoiceWarmupPhase } from '../../hooks/useVoiceWarmup';
import { useVoiceCommsSession, type VoiceCommsContextInput } from '../../hooks/useVoiceCommsSession';
import { voiceDisabledReason } from '../../voice/support';
import { resolveWakePhrase } from '../../voice/wake-phrase';
import type { VoiceConfig, VoiceSidecarHealth } from '../../api';
const VOICE_ACTIVE_STORAGE_KEY = 'agentx_voice_active_v1';

function readVoiceActiveFromStorage(): boolean {
  try {
    return localStorage.getItem(VOICE_ACTIVE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeVoiceActiveToStorage(active: boolean): void {
  try {
    localStorage.setItem(VOICE_ACTIVE_STORAGE_KEY, active ? '1' : '0');
  } catch {
    // ignore
  }
}

interface VoiceContextValue {
  coreSessionId: string | null;
  /** First voice config/capabilities fetch completed (success or failure). */
  voiceInitialized: boolean;
  /** Voice is explicitly turned off in settings (not first-run / deploying). */
  voiceExplicitlyDisabled: boolean;
  /** Kit deploy or capability fetch still in progress before dashboard. */
  voiceKitPending: boolean;
  voiceReady: boolean;
  /** Merged voice configuration (engine, mode, etc.). */
  voiceConfig: VoiceConfig | null;
  wakeWordEnabled: boolean;
  wakePhrase: string;
  warmupPhase: VoiceWarmupPhase;
  warmupHealth?: VoiceSidecarHealth;
  warmupError: string | null;
  warmupLabel: string;
  /** Settings → keep engine running at launch (docking warm-up). */
  engineWarmAtLaunch: boolean;
  ensureVoiceWarmup: () => void;
  retainVoiceEngine: () => void;
  releaseVoiceEngine: () => void;
  releaseVoiceSidecar: () => void;
  retryVoiceWarmup: () => void;
  /** Dashboard voice card active state (persisted across navigation). */
  voiceActive: boolean;
  /** True when the dashboard voice session is live (manual or wake-word). */
  commsActive: boolean;
  setVoiceActive: (active: boolean) => void;
  /**
   * Dashboard voice activation mode for the current/next activation:
   * - 'continue' (default): agent hydrates with recent transcript history.
   * - 'new': agent starts fresh; backend inserts a new_conversation divider.
   * Reset to 'continue' after the session starts so subsequent reconnections
   * don't re-insert dividers.
   */
  conversationMode: 'continue' | 'new';
  setConversationMode: (mode: 'continue' | 'new') => void;
}

/** Separate context for the dashboard comms session — avoids circular type
 *  dependency between VoiceContextValue and useVoiceCommsSession's return type. */
interface VoiceCommsContextValue {
  comms: ReturnType<typeof useVoiceCommsSession> | null;
}

const VoiceContext = createContext<VoiceContextValue | null>(null);
const VoiceCommsContext = createContext<VoiceCommsContextValue | null>(null);

export function useVoice(): VoiceContextValue {
  const ctx = useContext(VoiceContext);
  if (!ctx) {
    throw new Error('useVoice must be used within VoiceProvider');
  }
  return ctx;
}

export function useVoiceOptional(): VoiceContextValue | null {
  return useContext(VoiceContext);
}

/** Access the dashboard voice comms session (stays alive across navigation). */
export function useVoiceCommsOptional(): VoiceCommsContextValue | null {
  return useContext(VoiceCommsContext);
}

interface VoiceProviderProps {
  children: ReactNode;
}

export function VoiceProvider({ children }: VoiceProviderProps) {
  const location = useLocation();
  // PTT (Space key) only works on the dashboard page. xAI duplex works everywhere.
  const isDashboard = location.pathname === '/' || location.pathname === '/console' || location.pathname === '/console/dashboard';
  const [coreSessionId, setCoreSessionId] = useState<string | null>(null);
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [wakePhrase, setWakePhrase] = useState(() => resolveWakePhrase());
  const [canRunWeb, setCanRunWeb] = useState(false);
  const [voiceInitialized, setVoiceInitialized] = useState(false);
  const [voiceActive, setVoiceActiveState] = useState(() => readVoiceActiveFromStorage());
  const [conversationMode, setConversationModeState] = useState<'continue' | 'new'>('continue');
  const voiceConsumersRef = useRef(0);
  const releaseTimerRef = useRef<number | null>(null);

  const warmup = useVoiceWarmup(voiceEnabled, canRunWeb);

  const voiceReady = voiceEnabled && canRunWeb && !voiceDisabledReason();
  const voiceExplicitlyDisabled = Boolean(
    voiceConfig && voiceConfig.enabled === false && !wakeWordEnabled,
  );
  const voiceKitPending = voiceInitialized && !voiceExplicitlyDisabled && !voiceReady;

  // Session is active for the dashboard (manual) or for wake-word (always when enabled).
  const commsActive = (voiceActive || wakeWordEnabled) && voiceReady;

  // Build the voice context input for useVoiceCommsSession (avoids circular dep
  // on useVoiceOptional when called from within VoiceProvider).
  const commsVoiceContext: VoiceCommsContextInput = useMemo(() => ({
    voiceConfig: wakeWordEnabled && voiceConfig
      ? { ...voiceConfig, mode: { ...voiceConfig.mode, web: 'duplex' } }
      : voiceConfig,
    warmupPhase: warmup.phase,
    voiceReady,
    warmupError: warmup.error,
    wakeWordEnabled,
    wakePhrase,
  }), [voiceConfig, warmup.phase, voiceReady, warmup.error, wakeWordEnabled, wakePhrase]);

  // Dashboard voice-only comms session — lives at VoiceProvider level so the
  // WebSocket stays alive across page navigation. PTT keyboard is gated to the
  // dashboard page only; xAI duplex works on any page.
  const dashboardComms = useVoiceCommsSession({
    active: commsActive,
    voiceOnly: true,
    requestMicOnActivate: true,
    voiceContext: commsVoiceContext,
    pttKeyboardEnabled: isDashboard,
    conversationMode,
  });

  const setVoiceActive = useCallback((active: boolean) => {
    setVoiceActiveState(active);
    writeVoiceActiveToStorage(active);
  }, []);

  const setConversationMode = useCallback((mode: 'continue' | 'new') => {
    setConversationModeState(mode);
  }, []);

  // Reset conversationMode to 'continue' shortly after activation so the
  // divider + skip-hydrate only applies to the first turn of this activation.
  // Subsequent reconnections (e.g. engine swap) use normal history hydration.
  useEffect(() => {
    if (!voiceActive) return;
    const timer = window.setTimeout(() => setConversationModeState('continue'), 3_000);
    return () => window.clearTimeout(timer);
  }, [voiceActive]);

  const retainVoiceEngine = useCallback(() => {
    voiceConsumersRef.current += 1;
    if (releaseTimerRef.current !== null) {
      window.clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
    }
    warmup.ensureWarmup();
  }, [warmup.ensureWarmup]);

  const releaseVoiceEngine = useCallback(() => {
    voiceConsumersRef.current = Math.max(0, voiceConsumersRef.current - 1);
    if (voiceConsumersRef.current > 0) return;
    if (warmup.engineWarmAtLaunch) return;

    if (releaseTimerRef.current !== null) {
      window.clearTimeout(releaseTimerRef.current);
    }
    releaseTimerRef.current = window.setTimeout(() => {
      releaseTimerRef.current = null;
      if (voiceConsumersRef.current === 0 && !warmup.engineWarmAtLaunch) {
        warmup.releaseSidecar();
      }
    }, 400);
  }, [warmup.releaseSidecar, warmup.engineWarmAtLaunch]);

  // Retain/release the voice engine based on active voice session (dashboard or wake-word).
  // This keeps the engine warm as long as either session is active,
  // even when the user navigates to other pages.
  useEffect(() => {
    if (commsActive) {
      retainVoiceEngine();
      return () => { releaseVoiceEngine(); };
    }
  }, [commsActive, retainVoiceEngine, releaseVoiceEngine]);

  const applyVoiceConfigSnapshot = useCallback((cfg: VoiceConfig) => {
    setVoiceConfig(cfg);
    // Wake word is an active voice feature, so treat voice as enabled if either
    // the master switch or the wake-word switch is on.
    setVoiceEnabled(Boolean(cfg.enabled) || Boolean(cfg.wakeWord?.enabled));
    setWakeWordEnabled(Boolean(cfg.wakeWord?.enabled));
  }, []);

  const loadVoiceState = useCallback(async () => {
    try {
      const [cfg, caps, coreSessionId, persona] = await Promise.all([
        voice.getConfig(),
        voice.capabilities(),
        getCoreSessionId().catch(() => null),
        personaApi.get().catch(() => ({} as Record<string, never>)),
      ]);
      setVoiceConfig(cfg);
      // Wake word is an active voice feature, so treat voice as enabled if either
      // the master switch or the wake-word switch is on.
      setVoiceEnabled(Boolean(cfg.enabled) || Boolean(cfg.wakeWord?.enabled));
      setWakeWordEnabled(Boolean(cfg.wakeWord?.enabled));
      const personaName = typeof persona?.name === 'string' ? persona.name : null;
      const customPhrase = cfg.wakeWord?.phrase?.trim() ? cfg.wakeWord.phrase : null;
      setWakePhrase(resolveWakePhrase(customPhrase ?? personaName));
      setCanRunWeb(Boolean(caps.capabilities.canRunWeb));
      if (coreSessionId) setCoreSessionId(coreSessionId);
    } catch {
      setVoiceConfig(null);
      setVoiceEnabled(false);
      setCanRunWeb(false);
    } finally {
      setVoiceInitialized(true);
    }
  }, []);

  // Wake word is an always-on feature that can be triggered from any page, so
  // load voice config/capabilities at app start rather than only on the dashboard
  // or voice settings page. This ensures the duplex session starts even if the
  // user lands elsewhere.
  const voiceSurface = true;

  useEffect(() => {
    if (!voiceSurface) return;
    void loadVoiceState();
  }, [loadVoiceState, voiceSurface]);

  // While the kit is still deploying after reinstall, poll until capabilities flip ready.
  useEffect(() => {
    if (!voiceKitPending) return;
    const id = window.setInterval(() => { void loadVoiceState(); }, 2500);
    return () => window.clearInterval(id);
  }, [voiceKitPending, loadVoiceState]);

  // Warm the voice engine as soon as the kit is ready — docking waits on this before LAUNCH.
  useEffect(() => {
    if (!voiceReady) return;
    warmup.ensureWarmup();
  }, [voiceReady, warmup.ensureWarmup]);

  useEffect(() => {
    if (!voiceSurface) return;
    const onFocus = () => { void loadVoiceState(); };
    const onPersonaUpdated = () => { void loadVoiceState(); };
    const onVoiceUpdated = (event: Event) => {
      const detail = (event as CustomEvent<VoiceConfig | undefined>).detail;
      if (detail) {
        applyVoiceConfigSnapshot(detail);
      }
      void loadVoiceState();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('agentx:persona-updated', onPersonaUpdated);
    window.addEventListener('agentx:voice-updated', onVoiceUpdated);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('agentx:persona-updated', onPersonaUpdated);
      window.removeEventListener('agentx:voice-updated', onVoiceUpdated);
    };
  }, [loadVoiceState, applyVoiceConfigSnapshot, voiceSurface]);

  const value = useMemo<VoiceContextValue>(() => ({
    coreSessionId,
    voiceInitialized,
    voiceExplicitlyDisabled,
    voiceKitPending,
    voiceReady,
    voiceConfig,
    wakeWordEnabled,
    wakePhrase,
    warmupPhase: warmup.phase,
    warmupHealth: warmup.health,
    warmupError: warmup.error,
    warmupLabel: warmup.label,
    engineWarmAtLaunch: warmup.engineWarmAtLaunch,
    ensureVoiceWarmup: warmup.ensureWarmup,
    retainVoiceEngine,
    releaseVoiceEngine,
    releaseVoiceSidecar: releaseVoiceEngine,
    retryVoiceWarmup: warmup.retry,
    voiceActive,
    commsActive,
    setVoiceActive,
    conversationMode,
    setConversationMode,
  }), [
    coreSessionId,
    voiceInitialized,
    voiceExplicitlyDisabled,
    voiceKitPending,
    voiceReady,
    voiceConfig,
    wakeWordEnabled,
    wakePhrase,
    warmup.phase,
    warmup.health,
    warmup.error,
    warmup.label,
    warmup.engineWarmAtLaunch,
    warmup.ensureWarmup,
    retainVoiceEngine,
    releaseVoiceEngine,
    warmup.retry,
    voiceActive,
    commsActive,
    setVoiceActive,
    conversationMode,
    setConversationMode,
  ]);

  const commsContextValue = useMemo<VoiceCommsContextValue>(() => ({
    comms: dashboardComms,
  }), [dashboardComms]);

  return (
    <VoiceContext.Provider value={value}>
      <VoiceCommsContext.Provider value={commsContextValue}>
        {children}
      </VoiceCommsContext.Provider>
    </VoiceContext.Provider>
  );
}
