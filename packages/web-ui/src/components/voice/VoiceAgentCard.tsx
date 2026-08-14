import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import Popover from '@mui/material/Popover';
import MenuItem from '@mui/material/MenuItem';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import HearingIcon from '@mui/icons-material/Hearing';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import FiberNewIcon from '@mui/icons-material/FiberNew';
import { colors, alphaColor, MONO, getActiveScheme } from '../../theme';
import { useVoiceOptional, useVoiceCommsOptional } from './VoiceProvider';
import { voiceDisabledReason, notifyVoiceConfigUpdated } from '../../voice/support';
import { ThinkingOrb } from 'thinking-orbs';
import { VoiceParticleField, type ParticlePhase } from './VoiceParticleField';
import { VoiceTranscriptPanel } from './VoiceTranscriptPanel';
import { voice as voiceApi, providers as providersApi, models as modelsApi, modelBenchmark, sessions as sessionsApi } from '../../api';
import type { ConfiguredProvider, ModelInfo, VoiceConfig } from '../../api';
import { KOKORO_VOICE_PROFILES } from '../../voice/voice-config';
import { usePersonaName } from '../../hooks/usePersonaName';
import { ProviderSwitchModal } from '../chat/ProviderSwitchModal';

const VOICE_SESSION_ID = '__channel__:voice';

/**
 * Voice Agent card for the Bento dashboard — call-modal style centerpiece.
 *
 * Uses a segregated voice-only session (__channel__:voice) with a lean prompt
 * profile. The comms session lives in VoiceProvider so it stays alive across
 * page navigation. This component is a pure presentation layer that reads
 * voiceActive and comms state from context.
 *
 * Features:
 *  - Full-bleed particle field (same language as CrewCallModal)
 *  - Circular mic button with phase-reactive glow
 *  - Right transcript pane (latest 25, call-style logs, recycle on demand)
 *  - Toggle chips + provider/model dropdowns in the card header
 */

type ButtonPhase = 'disabled' | 'connecting' | 'idle' | 'recording' | 'thinking' | 'speaking' | 'muted';

export function VoiceAgentCard({
  onActiveChange,
  onPhaseChange,
  voiceprintEnabled,
}: {
  onActiveChange?: (active: boolean) => void;
  onPhaseChange?: (phase: ParticlePhase) => void;
  voiceprintEnabled?: boolean;
}) {
  const voiceCtx = useVoiceOptional();
  const commsCtx = useVoiceCommsOptional();
  const personaName = usePersonaName();
  const envBlocked = voiceDisabledReason();
  const voiceActive = voiceCtx?.voiceActive ?? false;
  const sessionActive = voiceCtx?.commsActive ?? false;
  const setVoiceActive = voiceCtx?.setVoiceActive;
  const setConversationMode = voiceCtx?.setConversationMode;
  const comms = commsCtx?.comms;

  const sessionReady = Boolean(voiceCtx?.voiceReady) && !envBlocked;
  const localEngine = (voiceCtx?.voiceConfig?.engine ?? 'stt_llm_tts') === 'stt_llm_tts';

  // ── Continue / New conversation modal ──────────────────────────────────
  // When the user activates voice and there is existing transcript history,
  // show a modal asking whether to continue the prior conversation (agent
  // hydrates with history) or start a new one (agent starts fresh; a
  // new_conversation divider row is inserted by the backend).
  const [showConvModal, setShowConvModal] = useState(false);
  const [checkingHistory, setCheckingHistory] = useState(false);
  const hasHistoryRef = useRef(false);

  const checkHasHistory = useCallback(async (): Promise<boolean> => {
    try {
      const page = await sessionsApi.getMessagesPage(VOICE_SESSION_ID, { limit: 1 });
      return (page.total ?? 0) > 0;
    } catch {
      return false;
    }
  }, []);

  const activateWithMode = useCallback((mode: 'continue' | 'new') => {
    setConversationMode?.(mode);
    setShowConvModal(false);
    setVoiceActive?.(true);
  }, [setConversationMode, setVoiceActive]);

  // Push toggle state to backend whenever wake or manual voice is active.
  useEffect(() => {
    if (sessionActive && sessionReady && comms) {
      comms.session.setToggles({ voiceprintEnabled: localEngine && Boolean(voiceprintEnabled) });
    }
  }, [sessionActive, sessionReady, voiceprintEnabled, comms, localEngine]);

  // Derive button phase — connecting stays blue; thinking is orange only after a turn.
  // Mic mute overrides listening/idle (green) to orange "Muted"; speaking/thinking stay.
  const phase: ButtonPhase = useMemo(() => {
    if (!sessionActive || !sessionReady || !comms) return 'disabled';
    if (comms.commsPhase === 'boot' || comms.commsPhase === 'link') return 'connecting';
    if (comms.session.state === 'connecting') return 'connecting';
    if (comms.commsPhase === 'agent_tx') return 'speaking';
    if (comms.commsPhase === 'operator_stt' || comms.commsPhase === 'relay_process' || comms.commsPhase === 'agent_prep') return 'thinking';
    if (comms.session.muted) return 'muted';
    if (comms.commsPhase === 'operator_record') return 'recording';
    return 'idle';
  }, [sessionActive, sessionReady, comms, comms?.session.muted, comms?.commsPhase, comms?.session.state]);

  const particlePhase: ParticlePhase = phase;

  const handleClick = async () => {
    if (!sessionReady || !setVoiceActive) return;
    // Deactivating: just turn off — no modal needed.
    if (voiceActive) {
      setVoiceActive(false);
      return;
    }
    // Activating: check if there's existing voice transcript history.
    // If yes, show the continue/new conversation modal. If no, activate
    // directly with 'continue' (there's nothing to start fresh from).
    setCheckingHistory(true);
    try {
      const hasHistory = await checkHasHistory();
      hasHistoryRef.current = hasHistory;
      if (hasHistory) {
        setShowConvModal(true);
      } else {
        setConversationMode?.('continue');
        setVoiceActive(true);
      }
    } catch {
      // If the history check fails, activate with default mode.
      setConversationMode?.('continue');
      setVoiceActive(true);
    } finally {
      setCheckingHistory(false);
    }
  };

  // Notify parent of active state changes (for connection pulses)
  useEffect(() => {
    onActiveChange?.(sessionActive && sessionReady);
  }, [sessionActive, sessionReady, onActiveChange]);

  // Notify parent of phase changes (for dashboard-wide particle field)
  useEffect(() => {
    onPhaseChange?.(particlePhase);
  }, [particlePhase, onPhaseChange]);

  const waveLevel = phase === 'recording'
    ? (comms?.session.audioLevel ?? 0)
    : phase === 'speaking'
      ? (comms?.session.playbackLevel ?? 0)
      : 0;

  const statusText = (() => {
    if (checkingHistory) return 'Checking…';
    if (!sessionActive) return 'Click to activate';
    if (!sessionReady) return 'Voice kit required';
    if (phase === 'disabled') return 'Click to activate';
    if (phase === 'connecting') return comms?.statusLabel || 'Connecting…';
    if (phase === 'muted') return 'Muted';
    if (phase === 'recording') return comms?.isDuplex ? 'Listening…' : 'Listening… release Space';
    if (phase === 'thinking') return comms?.statusLabel || 'Thinking…';
    if (phase === 'speaking') return 'Agent speaking';
    return comms?.statusLabel || (comms?.isDuplex ? 'Listening…' : 'Hold Space to speak');
  })();

  // Live lines: the user text is partial while recording and the final text after
  // transcript_final. The agent text is held until the turn completes so it doesn't
  // vanish between the live stream and the history reload.
  const liveUser = (comms?.session.transcript || '').trim();
  const liveAgent = (comms?.session.agentText || '').trim();

  // Reload history whenever a turn settles. finalTranscript changes on the user
  // utterance, agentText appears on the live stream, and agentTurnComplete fires
  // once the response is fully persisted. Including both in the key makes the
  // transcript panel reload immediately after each side of a turn lands.
  const transcriptRefresh = useMemo(() => {
    if (!sessionActive) return `disabled|${sessionActive}`;
    const final = comms?.session.finalTranscript ?? '';
    const agent = comms?.session.agentText ?? '';
    if (comms?.session.agentTurnComplete) return `complete|${final}|${agent}|${comms.session.agentTurnComplete}`;
    if (final) return `user|${final}|${agent}`;
    if (agent) return `agent|${final}|${agent}`;
    return 'live';
  }, [sessionActive, comms?.session.finalTranscript, comms?.session.agentText, comms?.session.agentTurnComplete]);

  return (
    <Box sx={{
      position: 'relative',
      display: 'flex',
      flexDirection: { xs: 'column', sm: 'row' },
      height: '100%',
      minHeight: 0,
      overflow: 'hidden',
    }}>
      {/* Particle stage | transcript — call-modal style equal split */}
      <Box sx={{
        position: 'relative',
        flex: { xs: '0 0 auto', sm: '0 0 50%' },
        width: { sm: '50%' },
        minWidth: 0,
        minHeight: { xs: 168, sm: 0 },
        overflow: 'hidden',
        bgcolor: alphaColor(colors.bg.primary, '40'),
      }}>
        <Box sx={{ position: 'absolute', inset: 0, zIndex: 0, opacity: sessionActive && sessionReady ? 1 : 0.55 }}>
          <VoiceParticleField
            phase={particlePhase}
            active={phase !== 'disabled'}
            level={waveLevel}
          />
        </Box>

        <Box sx={{
          position: 'absolute',
          inset: 0,
          zIndex: 2,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <Tooltip title={sessionReady ? (voiceActive ? 'Click to disable voice' : 'Click to enable voice') : 'Deploy voice kit first'}>
            <Box
              onClick={handleClick}
              sx={{
                width: 58,
                height: 58,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: sessionReady ? 'pointer' : 'default',
                transition: 'all 0.25s ease',
                pointerEvents: 'auto',
                border: `2px solid ${phaseColor(phase, true)}`,
                bgcolor: phase === 'disabled'
                  ? alphaColor(colors.text.dim, '0a')
                  : phase === 'idle' || phase === 'connecting'
                    ? alphaColor(colors.accent.blue, '14')
                    : phase === 'recording'
                      ? alphaColor(colors.accent.green, '1a')
                      : phase === 'speaking'
                        ? alphaColor(colors.accent.purple, '1a')
                        : alphaColor(colors.accent.orange, '14'),
                backdropFilter: 'blur(6px)',
                '&:hover': sessionReady && phase === 'idle' ? {
                  borderColor: colors.accent.blue,
                  transform: 'scale(1.05)',
                  boxShadow: `0 0 20px ${alphaColor(colors.accent.blue, '44')}`,
                } : {},
                ...(phase === 'connecting' && {
                  animation: 'voicePulseLink 1.4s ease-in-out infinite',
                  '@keyframes voicePulseLink': {
                    '0%, 100%': { boxShadow: `0 0 10px ${alphaColor(colors.accent.blue, '33')}` },
                    '50%': { boxShadow: `0 0 22px ${alphaColor(colors.accent.blue, '66')}` },
                  },
                }),
                ...(phase === 'recording' && {
                  animation: 'voicePulseRec 1.5s ease-in-out infinite',
                  '@keyframes voicePulseRec': {
                    '0%, 100%': { boxShadow: `0 0 12px ${alphaColor(colors.accent.green, '44')}` },
                    '50%': { boxShadow: `0 0 28px ${alphaColor(colors.accent.green, '77')}` },
                  },
                }),
                ...(phase === 'speaking' && {
                  animation: 'voicePulseSpeak 1.2s ease-in-out infinite',
                  '@keyframes voicePulseSpeak': {
                    '0%, 100%': { boxShadow: `0 0 12px ${alphaColor(colors.accent.purple, '44')}` },
                    '50%': { boxShadow: `0 0 28px ${alphaColor(colors.accent.purple, '77')}` },
                  },
                }),
              }}
            >
              {phase === 'connecting' ? (
                <ThinkingOrb state='connecting' size={64} theme={getActiveScheme() === 'dark' ? 'dark' : 'light'} style={{ width: 26, height: 26 }} />
              ) : phase === 'thinking' ? (
                <ThinkingOrb state='working' size={64} theme={getActiveScheme() === 'dark' ? 'dark' : 'light'} style={{ width: 26, height: 26 }} />
              ) : phase === 'disabled' ? (
                <MicOffIcon sx={{ fontSize: 24, color: colors.text.dim, opacity: 0.5 }} />
              ) : phase === 'muted' ? (
                <MicOffIcon sx={{ fontSize: 24, color: colors.accent.orange }} />
              ) : phase === 'recording' ? (
                <MicIcon sx={{ fontSize: 24, color: colors.accent.green }} />
              ) : phase === 'speaking' ? (
                <MicIcon sx={{ fontSize: 24, color: colors.accent.purple }} />
              ) : (
                <MicIcon sx={{ fontSize: 24, color: colors.accent.blue }} />
              )}
            </Box>
          </Tooltip>
        </Box>

        <Box sx={{
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: 10,
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          pointerEvents: 'none',
        }}>
          <Typography sx={{
            fontSize: '0.58rem',
            fontFamily: MONO,
            letterSpacing: '0.1em',
            color: phase === 'disabled'
              ? colors.text.dim
              : phase === 'recording'
                ? colors.accent.green
                : phase === 'speaking'
                  ? colors.accent.purple
                  : phase === 'thinking' || phase === 'muted'
                    ? colors.accent.orange
                    : phase === 'connecting'
                      ? colors.accent.blue
                      : colors.text.primary,
            px: 0.75,
            py: 0.35,
            borderRadius: '4px',
            bgcolor: alphaColor(colors.bg.primary, '8a'),
            border: `1px solid ${colors.border.default}`,
            transition: 'color 0.2s',
          }}>
            {statusText}
          </Typography>
        </Box>
      </Box>

      <VoiceTranscriptPanel
        liveUser={liveUser}
        liveUserLabel={comms?.session.speakerName}
        liveAgent={liveAgent}
        refreshToken={transcriptRefresh}
        agentLabel={personaName}
      />

      {/* Continue / New conversation modal — shown on activation when history exists */}
      <Dialog
        open={showConvModal}
        onClose={() => setShowConvModal(false)}
        maxWidth="xs"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              bgcolor: colors.bg.secondary,
              border: `1px solid ${colors.border.default}`,
              borderRadius: 2,
            },
          },
        }}
      >
        <DialogContent sx={{ p: 2.5 }}>
          <Typography sx={{
            fontSize: '0.75rem',
            fontFamily: MONO,
            letterSpacing: '0.08em',
            color: colors.text.primary,
            textTransform: 'uppercase',
            mb: 0.5,
          }}>
            Voice Session
          </Typography>
          <Typography sx={{
            fontSize: '0.65rem',
            fontFamily: MONO,
            color: colors.text.dim,
            mb: 2,
          }}>
            Continue from where you left off, or start a new conversation. The transcript stays either way.
          </Typography>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box
              component="button"
              type="button"
              onClick={() => activateWithMode('continue')}
              sx={{
                all: 'unset',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                p: 1.5,
                borderRadius: 1.5,
                border: `1px solid ${colors.border.default}`,
                bgcolor: alphaColor(colors.bg.tertiary, '60'),
                transition: 'border-color 0.15s, background 0.15s',
                '&:hover': {
                  borderColor: colors.accent.blue,
                  bgcolor: alphaColor(colors.accent.blue, '10'),
                },
              }}
            >
              <ChatBubbleOutlineIcon sx={{ fontSize: 20, color: colors.accent.blue, flexShrink: 0 }} />
              <Box>
                <Typography sx={{ fontSize: '0.7rem', fontFamily: MONO, color: colors.text.primary, mb: 0.2 }}>
                  Continue conversation
                </Typography>
                <Typography sx={{ fontSize: '0.55rem', fontFamily: MONO, color: colors.text.dim }}>
                  Agent remembers prior voice turns
                </Typography>
              </Box>
            </Box>

            <Box
              component="button"
              type="button"
              onClick={() => activateWithMode('new')}
              sx={{
                all: 'unset',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                p: 1.5,
                borderRadius: 1.5,
                border: `1px solid ${colors.border.default}`,
                bgcolor: alphaColor(colors.bg.tertiary, '60'),
                transition: 'border-color 0.15s, background 0.15s',
                '&:hover': {
                  borderColor: colors.accent.green,
                  bgcolor: alphaColor(colors.accent.green, '10'),
                },
              }}
            >
              <FiberNewIcon sx={{ fontSize: 20, color: colors.accent.green, flexShrink: 0 }} />
              <Box>
                <Typography sx={{ fontSize: '0.7rem', fontFamily: MONO, color: colors.text.primary, mb: 0.2 }}>
                  Start new conversation
                </Typography>
                <Typography sx={{ fontSize: '0.55rem', fontFamily: MONO, color: colors.text.dim }}>
                  Agent starts fresh · a divider marks the boundary
                </Typography>
              </Box>
            </Box>
          </Box>
        </DialogContent>
      </Dialog>

    </Box>
  );
}

/** Circular icon-only toggle chip for the card header. */
export function VoiceToggleChip({
  icon,
  active,
  activeColor,
  onClick,
  title,
  disabled = false,
}: {
  icon: React.ReactNode;
  active: boolean;
  activeColor: string;
  onClick: () => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <Tooltip title={title}>
      <Box
        onClick={disabled ? undefined : onClick}
        sx={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.4 : 1,
          border: `1px solid ${active && !disabled ? alphaColor(activeColor, '66') : colors.border.default}`,
          bgcolor: active && !disabled ? alphaColor(activeColor, '1a') : 'transparent',
          color: active && !disabled ? activeColor : colors.text.dim,
          transition: 'all 0.2s',
          '&:hover': disabled ? undefined : {
            borderColor: activeColor,
            color: activeColor,
            transform: 'scale(1.1)',
          },
        }}
      >
        {icon}
      </Box>
    </Tooltip>
  );
}

/** Exported so BentoDashboard can render toggles in the card header (right-aligned). */
export function VoiceAgentHeaderToggles({
  voiceprintEnabled,
  onVoiceprintEnabledChange,
}: {
  voiceprintEnabled: boolean;
  onVoiceprintEnabledChange: (v: boolean) => void;
}) {
  const engine = useVoiceOptional()?.voiceConfig?.engine ?? 'stt_llm_tts';
  if (engine !== 'stt_llm_tts') return null;
  return (
    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
      <VoiceToggleChip
        icon={<RecordVoiceOverIcon sx={{ fontSize: 13 }} />}
        active={voiceprintEnabled}
        activeColor={colors.accent.blue}
        onClick={() => onVoiceprintEnabledChange(!voiceprintEnabled)}
        title={voiceprintEnabled ? 'Voiceprint on' : 'Enable voiceprint'}
      />
    </Box>
  );
}

/**
 * Full header controls for the Voice Agent card: toggle chips + engine/voice
 * selectors. The engine chip shows the active voice engine (Local or xAI) and
 * allows switching. The voice chip loads voices based on the selected engine
 * (Kokoro voices for local, xAI voices for realtime). For the local engine,
 * provider/model selectors are also shown.
 */
export function VoiceAgentHeaderControls({
  voiceprintEnabled,
  onVoiceprintEnabledChange,
}: {
  voiceprintEnabled: boolean;
  onVoiceprintEnabledChange: (v: boolean) => void;
}) {
  const [configuredProviders, setConfiguredProviders] = useState<ConfiguredProvider[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [voiceCfg, setVoiceCfg] = useState<VoiceConfig | null>(null);
  const [defaultProvider, setDefaultProvider] = useState<string>('');
  const [defaultModel, setDefaultModel] = useState<string>('');
  const [xaiVoices, setXaiVoices] = useState<Array<{ id: string; name: string; language?: string }>>([]);
  const [engineAnchor, setEngineAnchor] = useState<HTMLElement | null>(null);
  const [providerAnchor, setProviderAnchor] = useState<HTMLElement | null>(null);
  const [modelAnchor, setModelAnchor] = useState<HTMLElement | null>(null);
  const [voiceAnchor, setVoiceAnchor] = useState<HTMLElement | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  // Provider switch modal state — forces model selection when switching providers (local engine only)
  const [providerSwitchPending, setProviderSwitchPending] = useState<{ providerId: string; providerLabel: string } | null>(null);

  const engine = voiceCfg?.engine ?? 'stt_llm_tts';
  const voiceProvider = voiceCfg?.provider?.activeProvider ?? null;
  const voiceModel = voiceCfg?.provider?.activeModel ?? null;
  const kokoroVoiceId = voiceCfg?.tts?.voiceId ?? 'kokoro-af';
  const xaiVoiceId = voiceCfg?.xai?.voice ?? 'eve';

  const voice = useVoiceOptional();
  const comms = useVoiceCommsOptional()?.comms;
  const wakeEnabled = voice?.wakeWordEnabled ?? false;
  const sessionActive = Boolean(voice?.commsActive);
  const micMuted = comms?.session.muted ?? false;

  const handleWakeToggle = useCallback(async () => {
    const cfg = voice?.voiceConfig;
    if (!cfg) return;
    const next: VoiceConfig = {
      ...cfg,
      enabled: !wakeEnabled ? true : cfg.enabled,
      wakeWord: { ...cfg.wakeWord, enabled: !wakeEnabled },
    };
    try {
      await voiceApi.updateConfig(next);
      notifyVoiceConfigUpdated(next);
    } catch { /* ignore */ }
  }, [voice?.voiceConfig, wakeEnabled]);

  // Load configured providers, current default, and voice config
  const loadConfig = async () => {
    try {
      const [configured, current, cfg] = await Promise.all([
        providersApi.configured(),
        modelsApi.current(),
        voiceApi.getConfig(),
      ]);
      setConfiguredProviders(configured);
      setDefaultProvider(current.provider || '');
      setDefaultModel(current.model || '');
      setVoiceCfg(cfg);
      if (cfg.engine === 'realtime_xai') {
        try {
          const voiceRes = await voiceApi.xaiVoices();
          setXaiVoices(voiceRes.voices);
        } catch {
          setXaiVoices([]);
        }
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    void loadConfig();
    const onVoiceUpdated = () => { void loadConfig(); };
    window.addEventListener('agentx:voice-updated', onVoiceUpdated);
    return () => window.removeEventListener('agentx:voice-updated', onVoiceUpdated);
  }, []);

  // Load cleared (benchmarked) models when provider changes (local engine only)
  useEffect(() => {
    if (engine !== 'stt_llm_tts') return;
    const providerId = voiceProvider || defaultProvider;
    if (!providerId) return;
    let cancelled = false;
    setLoadingModels(true);
    void (async () => {
      try {
        const [all, cleared] = await Promise.all([
          providersApi.models(providerId),
          modelBenchmark.cleared(providerId).catch(() => ({ models: [] as Array<{ modelId: string }> })),
        ]);
        if (cancelled) return;
        const allowed = new Set(cleared.models.map((m) => m.modelId));
        setModels(all.filter((m) => allowed.has(m.id)));
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoadingModels(false); }
    })();
    return () => { cancelled = true; };
  }, [voiceProvider, defaultProvider, engine]);

  const handleEngineSelect = async (nextEngine: 'stt_llm_tts' | 'realtime_xai') => {
    setEngineAnchor(null);
    if (nextEngine === engine) return;
    const isXai = nextEngine === 'realtime_xai';
    const currentWeb = voiceCfg?.mode?.web ?? 'off';
    const nextWeb = voiceCfg?.enabled ? (isXai ? 'duplex' : 'push-to-talk') : currentWeb;
    try {
      await voiceApi.updateConfig({
        ...voiceCfg,
        engine: nextEngine,
        mode: { ...voiceCfg?.mode, web: nextWeb },
      } as VoiceConfig);
    } catch { /* ignore */ }
  };

  const handleProviderSelect = async (providerId: string) => {
    setProviderAnchor(null);
    if (engine === 'stt_llm_tts' && providerId) {
      // Local engine: force model selection via modal before committing the switch
      const profile = configuredProviders.find((p) => p.id === providerId);
      const label = profile?.name || providerId;
      setProviderSwitchPending({ providerId, providerLabel: label });
      return;
    }
    // Realtime xAI engine: no model selection needed (uses realtime API)
    try {
      await voiceApi.updateConfig({ provider: { activeProvider: providerId || undefined, activeModel: undefined } } as VoiceConfig);
    } catch { /* ignore */ }
  };

  const confirmVoiceProviderSwitch = async (modelId: string) => {
    if (!providerSwitchPending) return;
    const { providerId } = providerSwitchPending;
    setProviderSwitchPending(null);
    try {
      await voiceApi.updateConfig({ provider: { activeProvider: providerId, activeModel: modelId } } as VoiceConfig);
    } catch { /* ignore */ }
  };

  const cancelVoiceProviderSwitch = () => {
    setProviderSwitchPending(null);
  };

  const handleModelSelect = async (modelId: string) => {
    setModelAnchor(null);
    try {
      await voiceApi.updateConfig({ provider: { activeModel: modelId || undefined } } as VoiceConfig);
    } catch { /* ignore */ }
  };

  const handleKokoroVoiceSelect = async (vid: string) => {
    setVoiceAnchor(null);
    try {
      await voiceApi.updateConfig({ tts: { voiceId: vid } } as VoiceConfig);
    } catch { /* ignore */ }
  };

  const handleXaiVoiceSelect = async (vid: string) => {
    setVoiceAnchor(null);
    try {
      await voiceApi.updateConfig({ xai: { voice: vid } } as VoiceConfig);
    } catch { /* ignore */ }
  };

  const engineLabel = engine === 'realtime_xai' ? 'xAI' : 'Local';
  const effectiveProvider = voiceProvider || defaultProvider;
  const effectiveModel = voiceModel || defaultModel;
  const matchedProvider = configuredProviders.find((p) => p.id === effectiveProvider);
  const profileLabel = matchedProvider?.activeProfile
    || matchedProvider?.name
    || effectiveProvider
    || '—';
  const modelLabel = effectiveModel ? effectiveModel.split('/').pop() || effectiveModel : '—';
  const kokoroProfile = KOKORO_VOICE_PROFILES.find((p) => p.id === kokoroVoiceId);
  const kokoroVoiceLabel = kokoroProfile?.name || kokoroVoiceId;
  const xaiVoiceMatch = xaiVoices.find((v) => v.id === xaiVoiceId);
  const xaiVoiceLabel = xaiVoiceMatch?.name || xaiVoiceId;
  const voiceLabel = engine === 'realtime_xai' ? xaiVoiceLabel : kokoroVoiceLabel;
  const showLocalVoiceGates = engine === 'stt_llm_tts';

  return (
    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
      {showLocalVoiceGates && (
        <>
          <VoiceToggleChip
            icon={<RecordVoiceOverIcon sx={{ fontSize: 13 }} />}
            active={voiceprintEnabled}
            activeColor={colors.accent.blue}
            onClick={() => onVoiceprintEnabledChange(!voiceprintEnabled)}
            title={voiceprintEnabled ? 'Voiceprint on' : 'Enable voiceprint'}
          />
          <VoiceToggleChip
            icon={<HearingIcon sx={{ fontSize: 13 }} />}
            active={wakeEnabled}
            activeColor={colors.accent.green}
            onClick={handleWakeToggle}
            title={wakeEnabled ? 'Wake word on — say the wake phrase to start' : 'Enable wake word'}
          />
        </>
      )}
      <VoiceToggleChip
        icon={micMuted ? <MicOffIcon sx={{ fontSize: 13 }} /> : <MicIcon sx={{ fontSize: 13 }} />}
        active={sessionActive}
        activeColor={micMuted ? colors.accent.orange : colors.accent.green}
        disabled={!sessionActive}
        onClick={() => comms?.session.setMuted(!micMuted)}
        title={!sessionActive
          ? 'Start the voice session to mute the mic'
          : micMuted
            ? 'Mic muted — click to unmute'
            : 'Mute mic'}
      />
      <ConfigChip
        label={engineLabel}
        onClick={(e) => setEngineAnchor(e.currentTarget)}
        active={engine === 'realtime_xai'}
      />
      {engine === 'stt_llm_tts' && (
        <>
          <ConfigChip
            label={profileLabel}
            onClick={(e) => setProviderAnchor(e.currentTarget)}
          />
          <ConfigChip
            label={modelLabel}
            onClick={(e) => setModelAnchor(e.currentTarget)}
          />
        </>
      )}
      <ConfigChip
        label={voiceLabel}
        onClick={(e) => setVoiceAnchor(e.currentTarget)}
      />

      {/* Engine dropdown — switch between Local and xAI */}
      <Popover
        open={Boolean(engineAnchor)}
        anchorEl={engineAnchor}
        onClose={() => setEngineAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 1 } }}
      >
        <Box sx={{ py: 0.5, minWidth: 160 }}>
          <MenuItem
            onClick={() => handleEngineSelect('stt_llm_tts')}
            selected={engine === 'stt_llm_tts'}
            sx={{ fontSize: '0.65rem', fontFamily: MONO, color: colors.text.secondary }}
          >
            Local · STT+LLM+TTS
          </MenuItem>
          <MenuItem
            onClick={() => handleEngineSelect('realtime_xai')}
            selected={engine === 'realtime_xai'}
            sx={{ fontSize: '0.65rem', fontFamily: MONO, color: colors.text.secondary }}
          >
            xAI · Grok Voice Agent
          </MenuItem>
        </Box>
      </Popover>

      {/* Provider dropdown — local engine only */}
      {engine === 'stt_llm_tts' && (
        <Popover
          open={Boolean(providerAnchor)}
          anchorEl={providerAnchor}
          onClose={() => setProviderAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 1 } }}
        >
          <Box sx={{ py: 0.5, minWidth: 160 }}>
            <MenuItem
              onClick={() => handleProviderSelect('')}
              selected={!voiceProvider}
              sx={{ fontSize: '0.65rem', fontFamily: MONO, color: colors.text.dim }}
            >
              <em>Use default ({defaultProvider || '—'})</em>
            </MenuItem>
            {configuredProviders.map((p) => (
              <MenuItem
                key={p.id}
                onClick={() => handleProviderSelect(p.id)}
                selected={p.id === voiceProvider}
                sx={{ fontSize: '0.65rem', fontFamily: MONO, color: colors.text.secondary }}
              >
                {p.name}{p.activeProfile ? ` · ${p.activeProfile}` : ''}
              </MenuItem>
            ))}
          </Box>
        </Popover>
      )}

      {/* Model dropdown — local engine only */}
      {engine === 'stt_llm_tts' && (
        <Popover
          open={Boolean(modelAnchor)}
          anchorEl={modelAnchor}
          onClose={() => setModelAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 1, maxHeight: 200, overflow: 'auto' } }}
        >
          <Box sx={{ py: 0.5, minWidth: 200 }}>
            {loadingModels ? (
              <MenuItem disabled sx={{ fontSize: '0.65rem', fontFamily: MONO, color: colors.text.dim }}>
                Loading models…
              </MenuItem>
            ) : (
              <>
                <MenuItem
                  onClick={() => handleModelSelect('')}
                  selected={!voiceModel}
                  sx={{ fontSize: '0.65rem', fontFamily: MONO, color: colors.text.dim }}
                >
                  <em>Use default ({defaultModel ? defaultModel.split('/').pop() : '—'})</em>
                </MenuItem>
                {models.length === 0 && (
                  <MenuItem disabled sx={{ fontSize: '0.65rem', fontFamily: MONO, color: colors.text.dim }}>
                    No cleared models — run a benchmark in Providers
                  </MenuItem>
                )}
                {models.map((m) => (
                  <MenuItem
                    key={m.id}
                    onClick={() => handleModelSelect(m.id)}
                    selected={m.id === voiceModel}
                    sx={{ fontSize: '0.65rem', fontFamily: MONO, color: colors.text.secondary }}
                  >
                    {m.name || m.id}
                  </MenuItem>
                ))}
              </>
            )}
          </Box>
        </Popover>
      )}

      {/* Voice dropdown — Kokoro (local) or xAI voices */}
      <Popover
        open={Boolean(voiceAnchor)}
        anchorEl={voiceAnchor}
        onClose={() => setVoiceAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 1, maxHeight: 280, overflow: 'auto' } }}
      >
        <Box sx={{ py: 0.5, minWidth: 180 }}>
          {engine === 'realtime_xai' ? (
            xaiVoices.length === 0 ? (
              <MenuItem disabled sx={{ fontSize: '0.6rem', fontFamily: MONO, color: colors.text.dim }}>
                No voices loaded — check xAI API key
              </MenuItem>
            ) : (
              xaiVoices.map((v) => (
                <MenuItem
                  key={v.id}
                  onClick={() => handleXaiVoiceSelect(v.id)}
                  selected={v.id === xaiVoiceId}
                  sx={{ fontSize: '0.6rem', fontFamily: MONO, color: colors.text.secondary, minHeight: 'auto', py: 0.25 }}
                >
                  {v.name} {v.language ? <span style={{ color: colors.text.dim, marginLeft: 4 }}>({v.language})</span> : null}
                </MenuItem>
              ))
            )
          ) : (
            Array.from(new Set(KOKORO_VOICE_PROFILES.map((p) => p.language))).map((language) => (
              <Box key={language}>
                <Typography sx={{ fontSize: '0.5rem', fontFamily: MONO, color: colors.text.dim, px: 1, pt: 0.5, pb: 0.25, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {language}
                </Typography>
                {KOKORO_VOICE_PROFILES.filter((p) => p.language === language).map((p) => (
                  <MenuItem
                    key={p.id}
                    onClick={() => handleKokoroVoiceSelect(p.id)}
                    selected={p.id === kokoroVoiceId}
                    sx={{ fontSize: '0.6rem', fontFamily: MONO, color: colors.text.secondary, minHeight: 'auto', py: 0.25 }}
                  >
                    {p.name} <span style={{ color: colors.text.dim, marginLeft: 4 }}>({p.gender})</span>
                  </MenuItem>
                ))}
              </Box>
            ))
          )}
        </Box>
      </Popover>

      {/* Provider switch modal — forces model selection when switching providers (local engine) */}
      <ProviderSwitchModal
        open={!!providerSwitchPending}
        providerId={providerSwitchPending?.providerId ?? ''}
        providerLabel={providerSwitchPending?.providerLabel ?? ''}
        onConfirm={confirmVoiceProviderSwitch}
        onCancel={cancelVoiceProviderSwitch}
      />
    </Box>
  );
}

/** Capsule-shaped chip (same height as VoiceToggleChip) with label only, opens dropdown on click. */
function ConfigChip({ label, onClick, active }: { label: string; onClick: (e: React.MouseEvent<HTMLElement>) => void; active?: boolean }) {
  return (
    <Box
      onClick={onClick}
      sx={{
        height: 22,
        display: 'flex',
        alignItems: 'center',
        px: 0.75,
        borderRadius: '11px',
        cursor: 'pointer',
        border: `1px solid ${active ? alphaColor(colors.accent.blue, '66') : colors.border.subtle}`,
        bgcolor: active ? alphaColor(colors.accent.blue, '1a') : alphaColor(colors.bg.primary, '80'),
        color: active ? colors.accent.blue : colors.text.dim,
        transition: 'all 0.15s',
        maxWidth: 120,
        '&:hover': {
          borderColor: colors.border.accent,
          color: colors.text.secondary,
        },
      }}
    >
      <Typography sx={{ fontSize: '0.5rem', fontFamily: MONO, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </Typography>
    </Box>
  );
}

function phaseColor(phase: ButtonPhase, border: boolean): string {
  switch (phase) {
    case 'disabled': return colors.border.default;
    case 'connecting':
    case 'idle': return border ? alphaColor(colors.accent.blue, '66') : colors.accent.blue;
    case 'recording': return border ? alphaColor(colors.accent.green, '66') : colors.accent.green;
    case 'thinking':
    case 'muted': return border ? alphaColor(colors.accent.orange, '66') : colors.accent.orange;
    case 'speaking': return border ? alphaColor(colors.accent.purple, '66') : colors.accent.purple;
  }
}
