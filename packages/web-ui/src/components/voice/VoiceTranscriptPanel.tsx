import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { colors, alphaColor, MONO } from '../../theme';
import { sessions } from '../../api';
import { sanitizeVoiceDisplayText } from '../../voice/sanitize-display-text';
import { LastShownChip } from '../../visual/LastShownChip';
import { parseCallDivider, readCallDividerMeta } from '@agentx/shared/browser';
import type { ChatMessage } from '../../api';

const VOICE_SESSION_ID = '__channel__:voice';
/** Default window — matches chat recycler spirit, sized for the voice card. */
export const VOICE_TRANSCRIPT_PAGE = 25;
const VOICE_TRANSCRIPT_WINDOW_MAX = VOICE_TRANSCRIPT_PAGE * 2;

/** A transcript line — either a spoken turn or a divider. */
interface TranscriptLine {
  id: string;
  role: 'user' | 'assistant' | 'divider';
  text: string;
  speakerName?: string | null;
  /** Divider variant (daytime / time / duration / new_conversation) — only for divider lines. */
  dividerVariant?: string;
  /** Raw message — used for dedup and older-page logic. */
  raw: ChatMessage;
}

/**
 * Map raw chat messages into transcript lines, preserving divider rows
 * (role 'system' with [call_divider:...] content or metadata.callDivider).
 * Spoken turns are filtered to user/assistant with non-empty sanitized text.
 */
function mapTranscriptLines(messages: ChatMessage[]): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  for (const m of messages) {
    const id = m.id || crypto.randomUUID();
    const content = (m.content || '').trim();

    // Divider rows: standalone system messages with [call_divider:...] content
    // or metadata.callDivider. These are persisted by the backend — never
    // computed on the frontend.
    const divider = parseCallDivider(content, m.metadata);
    if (divider && (/^\[call_divider:/i.test(content) || m.role === 'system')) {
      lines.push({
        id,
        role: 'divider',
        text: divider.label,
        dividerVariant: divider.variant,
        raw: m,
      });
      continue;
    }

    // Also handle dividers attached as metadata on spoken turns (the
    // call-divider-before-turn pattern). Emit a divider line first.
    const beforeDivider = readCallDividerMeta(m.metadata);
    if (beforeDivider && (m.role === 'user' || m.role === 'assistant')) {
      lines.push({
        id: `${id}-div`,
        role: 'divider',
        text: beforeDivider.label,
        dividerVariant: beforeDivider.variant,
        raw: m,
      });
    }

    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const text = sanitizeVoiceDisplayText(content);
    if (!text) continue;
    const speakerName = typeof m.metadata?.speakerName === 'string' ? m.metadata.speakerName : null;
    // Collapse consecutive identical user turns (double persist / double ASR final).
    const last = lines[lines.length - 1];
    if (
      last
      && last.role === m.role
      && last.role === 'user'
      && last.text === text
      && (last.speakerName ?? null) === (speakerName ?? null)
    ) {
      continue;
    }
    lines.push({ id, role: m.role, text, speakerName, raw: m });
  }
  return lines;
}

/** Streaming deltas grow (or briefly shrink); a new utterance does neither. */
function isAgentTranscriptContinuation(prev: string, next: string): boolean {
  if (!prev) return true;
  if (!next) return false;
  return next.startsWith(prev) || prev.startsWith(next);
}

interface SettledAgentLine {
  id: string;
  text: string;
}

/** Drop settled live lines once history contains the same assistant texts. */
function unmatchedSettledAgentLines(settled: SettledAgentLine[], historyTexts: string[]): SettledAgentLine[] {
  const remaining = [...historyTexts];
  return settled.filter((line) => {
    const idx = remaining.indexOf(line.text);
    if (idx === -1) return true;
    remaining.splice(idx, 1);
    return false;
  });
}

/**
 * Call-style log transcript for the Voice Agent card (not chat bubbles).
 * Latest 25 messages; older pages load on demand with sliding-window recycle.
 */
export function VoiceTranscriptPanel({
  liveUser,
  liveUserLabel,
  liveAgent,
  refreshToken,
  agentLabel = 'Agent',
}: {
  liveUser?: string;
  liveUserLabel?: string | null;
  liveAgent?: string;
  refreshToken?: string | number;
  /** Persona name for agent lines (defaults to "Agent"). */
  agentLabel?: string;
}) {
  const [messages, setMessages] = useState<TranscriptLine[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  /** Sticky live lines until history catch-up (assistant persist lags phase idle). */
  const [pendingUser, setPendingUser] = useState('');
  /** Completed agent utterances not yet in history — consecutive replies must not share one slot. */
  const [settledAgents, setSettledAgents] = useState<SettledAgentLine[]>([]);
  const prevLiveAgentRef = useRef('');
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const liveCapRef = useRef(true);
  const detachedRef = useRef(false);
  const hasMessagesRef = useRef(false);
  hasMessagesRef.current = messages.length > 0;

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const loadLatest = useCallback(async (opts?: { soft?: boolean }) => {
    const soft = opts?.soft === true && hasMessagesRef.current;
    if (!soft) setLoading(true);
    try {
      const page = await sessions.getMessagesPage(VOICE_SESSION_ID, { limit: VOICE_TRANSCRIPT_PAGE });
      const mapped = mapTranscriptLines(page.messages);
      setMessages(mapped);
      setHasOlder(page.hasMore || mapped.length >= VOICE_TRANSCRIPT_PAGE);
      liveCapRef.current = true;
      detachedRef.current = false;
      requestAnimationFrame(() => scrollToBottom('auto'));
    } catch {
      if (!soft) {
        setMessages([]);
        setHasOlder(false);
      }
    } finally {
      if (!soft) setLoading(false);
    }
  }, [scrollToBottom]);

  useEffect(() => {
    const soft = hasMessagesRef.current;
    void loadLatest({ soft });
    // Assistant rows often land slightly after the UI returns to idle.
    if (refreshToken !== undefined && refreshToken !== 'live') {
      const t1 = window.setTimeout(() => { void loadLatest({ soft: true }); }, 350);
      const t2 = window.setTimeout(() => { void loadLatest({ soft: true }); }, 1100);
      return () => {
        window.clearTimeout(t1);
        window.clearTimeout(t2);
      };
    }
    return undefined;
  }, [loadLatest, refreshToken]);

  useEffect(() => {
    if (!liveCapRef.current) return;
    if (messages.length <= VOICE_TRANSCRIPT_PAGE) return;
    setHasOlder(true);
    setMessages((prev) => (prev.length > VOICE_TRANSCRIPT_PAGE ? prev.slice(-VOICE_TRANSCRIPT_PAGE) : prev));
  }, [messages.length]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasOlder) return;
    const first = messages.find((m) => m.role === 'user' || m.role === 'assistant');
    if (!first?.id) return;
    setLoadingOlder(true);
    liveCapRef.current = false;
    const el = scrollerRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const page = await sessions.getMessagesPage(VOICE_SESSION_ID, {
        limit: VOICE_TRANSCRIPT_PAGE,
        before: first.id,
      });
      const older = mapTranscriptLines(page.messages);
      if (!older.length) {
        setHasOlder(false);
        return;
      }
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const prepend = older.filter((m) => !seen.has(m.id));
        if (!prepend.length) return prev;
        let next = [...prepend, ...prev];
        if (next.length > VOICE_TRANSCRIPT_WINDOW_MAX) {
          next = next.slice(0, next.length - VOICE_TRANSCRIPT_PAGE);
          detachedRef.current = true;
        }
        return next;
      });
      setHasOlder(page.hasMore);
      requestAnimationFrame(() => {
        if (!el) return;
        el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch {
      /* best-effort */
    } finally {
      setLoadingOlder(false);
    }
  }, [hasOlder, loadingOlder, messages]);

  const liveUserClean = sanitizeVoiceDisplayText(liveUser || '');
  const liveAgentClean = sanitizeVoiceDisplayText(liveAgent || '');

  useEffect(() => {
    if (liveUserClean) {
      setPendingUser(liveUserClean);
    }
    // Do not clear pending when live text clears — history catch-up clears it below.
  }, [liveUserClean]);

  useEffect(() => {
    const prev = prevLiveAgentRef.current;
    const next = liveAgentClean;
    if (prev && !isAgentTranscriptContinuation(prev, next)) {
      setSettledAgents((list) => (
        list[list.length - 1]?.text === prev
          ? list
          : [...list, { id: crypto.randomUUID(), text: prev }]
      ));
    }
    prevLiveAgentRef.current = next;
  }, [liveAgentClean]);

  // Avoid duplicate lines when history already includes the same utterance
  // (common while Local engine is thinking after STT persists the user turn).
  const lastUserText = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i]!;
      if (m.role === 'user') return m.text;
    }
    return '';
  })();
  const historyAgentTexts = messages.filter((m) => m.role === 'assistant').map((m) => m.text);
  const lastAgentText = historyAgentTexts[historyAgentTexts.length - 1] ?? '';
  const unmatchedSettled = unmatchedSettledAgentLines(settledAgents, historyAgentTexts);

  useEffect(() => {
    const historyTexts = messages.filter((m) => m.role === 'assistant').map((m) => m.text);
    setSettledAgents((prev) => {
      const next = unmatchedSettledAgentLines(prev, historyTexts);
      if (next.length === prev.length && next.every((line, i) => line.id === prev[i]?.id)) return prev;
      return next;
    });
  }, [messages]);

  useEffect(() => {
    if (pendingUser && pendingUser === lastUserText) setPendingUser('');
  }, [pendingUser, lastUserText]);

  const displayUser = liveUserClean || pendingUser;
  const lastSettledText = unmatchedSettled[unmatchedSettled.length - 1]?.text ?? '';
  const showLiveUser = Boolean(displayUser) && displayUser !== lastUserText;
  const showLiveAgent = Boolean(liveAgentClean)
    && liveAgentClean !== lastAgentText
    && liveAgentClean !== lastSettledText;

  useEffect(() => {
    if (showLiveUser || showLiveAgent || unmatchedSettled.length > 0) scrollToBottom('smooth');
  }, [showLiveUser, showLiveAgent, displayUser, liveAgentClean, unmatchedSettled.length, scrollToBottom]);

  return (
    <Box sx={{
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      borderLeft: { xs: 'none', sm: `1px solid ${colors.border.subtle}` },
      borderTop: { xs: `1px solid ${colors.border.subtle}`, sm: 'none' },
      bgcolor: alphaColor(colors.bg.primary, '55'),
    }}>
      <Box sx={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 1.1,
        py: 0.55,
        borderBottom: `1px solid ${colors.border.subtle}`,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <Typography sx={{
            fontSize: '0.52rem',
            fontFamily: MONO,
            letterSpacing: '1.2px',
            color: colors.text.dim,
            textTransform: 'uppercase',
          }}>
            Transcript
          </Typography>
          <LastShownChip />
        </Box>
        {detachedRef.current && (
          <Box
            component="button"
            type="button"
            onClick={() => { void loadLatest(); }}
            sx={{
              all: 'unset',
              cursor: 'pointer',
              fontSize: '0.5rem',
              fontFamily: MONO,
              color: colors.accent.blue,
              '&:hover': { color: colors.text.primary },
            }}
          >
            Latest
          </Box>
        )}
      </Box>

      <Box
        ref={scrollerRef}
        className="ax-scroll-y"
        sx={{
          flex: 1,
          minHeight: 0,
          px: 1.15,
          py: 0.85,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.75,
          bgcolor: alphaColor(colors.bg.tertiary, '40'),
        }}
      >
        {hasOlder && (
          <Box
            component="button"
            type="button"
            onClick={() => { void loadOlder(); }}
            disabled={loadingOlder}
            sx={{
              all: 'unset',
              cursor: loadingOlder ? 'default' : 'pointer',
              alignSelf: 'center',
              px: 1,
              py: 0.3,
              mb: 0.15,
              borderRadius: '999px',
              border: `1px solid ${colors.border.default}`,
              fontSize: '0.48rem',
              fontFamily: MONO,
              letterSpacing: '0.08em',
              color: colors.text.dim,
              '&:hover': { color: colors.text.secondary, borderColor: colors.border.strong },
            }}
          >
            {loadingOlder ? 'LOADING…' : 'EARLIER'}
          </Box>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={14} sx={{ color: colors.text.dim }} />
          </Box>
        ) : messages.length === 0 && !showLiveUser && !showLiveAgent && unmatchedSettled.length === 0 ? (
          <Typography sx={{
            fontSize: '0.6rem',
            fontFamily: MONO,
            color: colors.text.dim,
            py: 1.5,
          }}>
            Waiting for voice…
          </Typography>
        ) : (
          messages.map((m) => (
            m.role === 'divider' ? (
              <DividerLine key={m.id} label={m.text} variant={m.dividerVariant} />
            ) : (
              <LogLine
                key={m.id}
                role={m.role === 'user' ? 'operator' : 'agent'}
                text={m.text}
                agentLabel={agentLabel}
                speakerName={m.speakerName}
              />
            )
          ))
        )}

        {unmatchedSettled.map((line) => (
          <LogLine
            key={line.id}
            role="agent"
            text={line.text}
            agentLabel={agentLabel}
          />
        ))}

        {showLiveUser && (
          <LogLine
            role="operator"
            text={displayUser}
            live={Boolean(liveUserClean)}
            agentLabel={agentLabel}
            speakerName={liveUserLabel}
          />
        )}
        {showLiveAgent && (
          <LogLine
            role="agent"
            text={liveAgentClean}
            live
            agentLabel={agentLabel}
          />
        )}
      </Box>
    </Box>
  );
}

function LogLine({
  role,
  text,
  live,
  agentLabel = 'Agent',
  speakerName,
}: {
  role: 'operator' | 'agent';
  text: string;
  live?: boolean;
  agentLabel?: string;
  speakerName?: string | null;
}) {
  const color = role === 'operator' ? colors.accent.green : colors.accent.blue;
  const label = role === 'operator' ? (speakerName ?? 'anonymous') : agentLabel;
  return (
    <Box sx={{ opacity: live ? 0.75 : 1 }}>
      <Typography sx={{
        fontFamily: MONO,
        fontSize: '0.48rem',
        letterSpacing: '0.06em',
        color,
        mb: 0.15,
      }}>
        {label}{live ? ' · live' : ''}
      </Typography>
      <Typography sx={{
        fontFamily: MONO,
        fontSize: '0.65rem',
        color: live ? colors.text.dim : colors.text.secondary,
        lineHeight: 1.4,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {text}
      </Typography>
    </Box>
  );
}

/**
 * Divider line — a centered horizontal rule with a label, rendered from a
 * persisted message-table row (role 'system', content [call_divider:…]).
 * Never computed on the frontend; the backend inserts the row.
 */
function DividerLine({
  label,
  variant,
}: {
  label: string;
  variant?: string;
}) {
  const isNewConversation = variant === 'new_conversation';
  const accentColor = isNewConversation ? colors.accent.green : colors.text.dim;
  return (
    <Box sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 0.75,
      my: 0.5,
      width: '100%',
    }}>
      <Box sx={{
        flex: 1,
        height: '1px',
        bgcolor: alphaColor(accentColor, '30'),
      }} />
      <Typography sx={{
        fontFamily: MONO,
        fontSize: '0.45rem',
        letterSpacing: '0.1em',
        color: accentColor,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        ...(isNewConversation ? {
          px: 0.75,
          py: 0.15,
          border: `1px solid ${alphaColor(accentColor, '40')}`,
          borderRadius: '999px',
          bgcolor: alphaColor(accentColor, '8'),
        } : {}),
      }}>
        {label}
      </Typography>
      <Box sx={{
        flex: 1,
        height: '1px',
        bgcolor: alphaColor(accentColor, '30'),
      }} />
    </Box>
  );
}
