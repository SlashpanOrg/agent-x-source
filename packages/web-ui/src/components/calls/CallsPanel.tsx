import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import PhoneInTalkIcon from '@mui/icons-material/PhoneInTalk';
import CallIcon from '@mui/icons-material/Call';
import CallReceivedIcon from '@mui/icons-material/CallReceived';
import CallMadeIcon from '@mui/icons-material/CallMade';
import AddIcCallIcon from '@mui/icons-material/AddIcCall';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import { crewChat, sessions, telephonyApi, type VoiceCallSummary } from '../../api';
import { getCrewAccent } from '../../styles/crew-theme';
import { colors, alphaColor, PANEL_SIDE_LIST_WIDTH } from '../../theme';
import {
  useCrewCall,
  crewCallTargetFromVoiceSession,
  mapCallHistoryMessages,
  type CrewCallTranscriptLine,
} from '../crew-call';
import { CallTranscriptDivider } from '../crew-call/CallTranscriptDivider';
import {
  crewRowFromSession,
  voipRowFromCall,
  groupCallSessionsByDay,
  sortCallsLatestFirst,
  type UnifiedCallRow,
} from './call-list-groups';
import { CrewCallPhonebookModal } from './CrewCallPhonebookModal';

const MONO = "'JetBrains Mono', monospace";

function DateGroupDivider({ label, first }: { label: string; first?: boolean }) {
  return (
    <Box sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 0.6,
      mt: first ? 0.25 : 1.1,
      mb: 0.55,
      px: 0.75,
    }}>
      <Box sx={{ flex: 1, height: '1px', bgcolor: colors.border.subtle }} />
      <Typography sx={{
        fontSize: '0.48rem',
        letterSpacing: '0.09em',
        textTransform: 'uppercase',
        color: colors.text.dim,
        fontFamily: MONO,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}>
        [{label}]
      </Typography>
      <Box sx={{ flex: 1, height: '1px', bgcolor: colors.border.subtle }} />
    </Box>
  );
}

function relativeTime(iso?: string): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 86_400_000 * 7) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function KindTag({ label, accent }: { label: string; accent: string }) {
  return (
    <Typography
      component="span"
      sx={{
        fontFamily: MONO,
        fontSize: '0.4rem',
        fontWeight: 700,
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
        color: accent,
        border: `1px solid ${alphaColor(accent, 0.4)}`,
        borderRadius: '3px',
        px: 0.4,
        py: 0.05,
        lineHeight: 1.4,
        flexShrink: 0,
      }}
    >
      {label}
    </Typography>
  );
}

const CallRow = memo(function CallRow({
  row,
  selected,
  onSelect,
  onRequestDelete,
}: {
  row: UnifiedCallRow;
  selected: boolean;
  onSelect: (id: string) => void;
  onRequestDelete: (id: string) => void;
}) {
  const isVoip = row.kind === 'voip';
  const accent = isVoip
    ? colors.accent.cyan
    : getCrewAccent(row.crew.hostCrewColor ?? undefined, row.crew.hostCrewCallsign ?? undefined);
  const callsign = isVoip ? '' : (row.crew.hostCrewCallsign ?? '??').slice(0, 2).toUpperCase();

  const title = isVoip
    ? (row.voip.from && row.voip.to ? `${row.voip.from} → ${row.voip.to}` : row.voip.providerId)
    : (row.crew.hostCrewName ?? row.crew.title ?? 'Unknown');

  const timeLabel = isVoip
    ? relativeTime(row.voip.startedAt ?? row.voip.endedAt ?? undefined)
    : relativeTime(row.crew.updatedAt ?? row.crew.createdAt);

  return (
    <Box
      onClick={() => onSelect(row.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(row.id);
        }
      }}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        width: '100%',
        px: 1.25,
        py: 1,
        cursor: 'pointer',
        boxSizing: 'border-box',
        borderLeft: `2px solid ${selected ? accent : 'transparent'}`,
        bgcolor: selected ? alphaColor(accent, 0.1) : 'transparent',
        contain: 'layout style',
        transition: 'background-color 120ms ease, border-color 120ms ease',
        '&:hover': { bgcolor: selected ? alphaColor(accent, 0.12) : colors.bg.hover },
        '&:focus-visible': { outline: `1px solid ${alphaColor(accent, 0.5)}`, outlineOffset: -1 },
        '&:hover .call-row-delete': { opacity: 1 },
      }}
    >
      <Box
        sx={{
          width: 30,
          height: 30,
          borderRadius: '7px',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: MONO,
          fontSize: '0.58rem',
          fontWeight: 700,
          color: accent,
          bgcolor: alphaColor(accent, 0.12),
          border: `1px solid ${alphaColor(accent, 0.35)}`,
        }}
      >
        {isVoip ? (
          row.voip.direction === 'inbound'
            ? <CallReceivedIcon sx={{ fontSize: 15 }} />
            : <CallMadeIcon sx={{ fontSize: 15 }} />
        ) : callsign}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography
            noWrap
            sx={{
              fontFamily: MONO,
              fontSize: '0.72rem',
              fontWeight: 600,
              color: colors.text.primary,
              lineHeight: 1.2,
            }}
          >
            {title}
          </Typography>
          {!isVoip && <KindTag label="Crew" accent={accent} />}
        </Box>
        <Typography
          noWrap
          sx={{
            fontFamily: MONO,
            fontSize: '0.52rem',
            color: colors.text.dim,
            letterSpacing: '0.04em',
            mt: 0.15,
          }}
        >
          {isVoip
            ? `VOIP · ${row.voip.direction} · ${row.voip.state}`
            : `@${row.crew.hostCrewCallsign ?? 'crew'}${row.crew.hostCrewTitle ? ` · ${row.crew.hostCrewTitle}` : ''}`}
        </Typography>
      </Box>
      <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: colors.text.dim }}>
          {timeLabel}
        </Typography>
        {!isVoip && (
          <Typography sx={{ fontFamily: MONO, fontSize: '0.48rem', color: alphaColor(accent, 0.85), mt: 0.2 }}>
            {row.crew.messageCount ?? 0} lines
          </Typography>
        )}
      </Box>
      {!isVoip && (
        <Tooltip title="Delete call" arrow>
          <IconButton
            className="call-row-delete"
            size="small"
            aria-label="Delete call"
            onClick={(e) => {
              e.stopPropagation();
              onRequestDelete(row.id);
            }}
            sx={{
              p: 0.35,
              opacity: selected ? 0.85 : 0,
              color: colors.text.dim,
              transition: 'opacity 120ms ease, color 120ms ease',
              '&:hover': { color: colors.accent.red, bgcolor: alphaColor(colors.accent.red, 0.12) },
            }}
          >
            <DeleteOutlineIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
});

function TranscriptBody({
  lines,
  speakerName,
  accent,
  loading,
}: {
  lines: CrewCallTranscriptLine[];
  /** Display name of the crew member (not callsign). */
  speakerName: string;
  accent: string;
  loading: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [lines.length]);

  if (loading && lines.length === 0) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={18} sx={{ color: colors.accent.blue }} />
      </Box>
    );
  }

  if (lines.length === 0) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', px: 3 }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: colors.text.dim, textAlign: 'center' }}>
          No transcript yet — place a call to start the record.
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      className="ax-scroll-y"
      sx={{
        flex: 1,
        minHeight: 0,
        px: 2,
        py: 1.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        bgcolor: colors.bg.secondary,
        contentVisibility: 'auto',
      }}
    >
      {lines.map((line) => {
        if (line.divider) {
          return (
            <CallTranscriptDivider
              key={line.id}
              label={line.text}
              variant={line.divider}
              mutedColor={colors.text.dim}
              lineColor={alphaColor(colors.text.dim, 0.25)}
              monoFont={MONO}
            />
          );
        }
        const color =
          line.role === 'operator' ? colors.accent.cyan
            : line.role === 'crew' ? accent
              : colors.text.dim;
        const label = line.role === 'operator' ? (line.speakerName ?? 'You') : line.role === 'crew' ? speakerName : 'System';
        return (
          <Box key={line.id} sx={{ contain: 'layout style' }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.48rem', letterSpacing: '0.06em', color, mb: 0.2 }}>
              {label}
            </Typography>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: colors.text.secondary, lineHeight: 1.45 }}>
              {line.text}
            </Typography>
          </Box>
        );
      })}
      <div ref={bottomRef} />
    </Box>
  );
}

function DetailStat({ label, value, accent }: { label: string; value?: string | null; accent: string }) {
  return (
    <Box
      sx={{
        px: 1,
        py: 0.5,
        borderRadius: '4px',
        border: `1px solid ${alphaColor(accent, 0.3)}`,
        bgcolor: alphaColor(accent, 0.08),
      }}
    >
      <Typography sx={{ fontFamily: MONO, fontSize: '0.44rem', letterSpacing: '0.06em', color: colors.text.dim, textTransform: 'uppercase' }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: accent, fontWeight: 700 }}>
        {value || '—'}
      </Typography>
    </Box>
  );
}

function VoipDetailBody({ call, accent }: { call: VoiceCallSummary; accent: string }) {
  const summary = call.outcomeSummary?.trim() || call.outcome?.trim() || 'No outcome summary available yet.';
  return (
    <Box
      className="ax-scroll-y"
      sx={{
        flex: 1,
        minHeight: 0,
        px: 2,
        py: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        bgcolor: colors.bg.secondary,
      }}
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        <DetailStat label="Provider" value={call.providerId} accent={accent} />
        <DetailStat label="Direction" value={call.direction} accent={accent} />
        <DetailStat label="State" value={call.state} accent={accent} />
      </Box>
      <Box>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.48rem', letterSpacing: '0.08em', color: colors.text.dim, mb: 0.4, textTransform: 'uppercase' }}>
          Outcome
        </Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: colors.text.secondary, lineHeight: 1.5 }}>
          {summary}
        </Typography>
      </Box>
    </Box>
  );
}

export function CallsPanel() {
  const { startCall, isActive } = useCrewCall();
  const [rows, setRows] = useState<UnifiedCallRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [, startTransition] = useTransition();
  const [transcript, setTranscript] = useState<CrewCallTranscriptLine[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [phonebookOpen, setPhonebookOpen] = useState(false);
  const oldestIdRef = useRef<string | null>(null);
  const loadGenRef = useRef(0);

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const [sessionsRes, callsRes] = await Promise.all([
        crewChat.listVoiceSessions(),
        telephonyApi.listCalls().catch(() => null),
      ]);
      const crewRows = (sessionsRes.sessions ?? []).map(crewRowFromSession);
      const voipRows = (callsRes?.calls ?? []).map(voipRowFromCall);
      const next = sortCallsLatestFirst([...crewRows, ...voipRows]);
      setRows(next);
      setSelectedId((prev) => {
        if (prev && next.some((r) => r.id === prev)) return prev;
        return next[0]?.id ?? null;
      });
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Failed to load calls');
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (isActive) return;
    const id = window.setTimeout(() => { void loadList(); }, 400);
    return () => window.clearTimeout(id);
  }, [isActive, loadList]);

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const selectedAccent = useMemo(() => {
    if (!selected) return colors.accent.green;
    if (selected.kind === 'crew') {
      return getCrewAccent(selected.crew.hostCrewColor ?? undefined, selected.crew.hostCrewCallsign ?? undefined);
    }
    return colors.accent.cyan;
  }, [selected]);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const base = q
      ? rows.filter((r) => {
          if (r.kind === 'crew') {
            const c = r.crew;
            const hay = `${c.hostCrewName ?? ''} ${c.hostCrewCallsign ?? ''} ${c.hostCrewTitle ?? ''} ${c.title ?? ''}`.toLowerCase();
            return hay.includes(q);
          }
          const v = r.voip;
          const hay = `${v.from ?? ''} ${v.to ?? ''} ${v.providerId ?? ''} ${v.direction ?? ''}`.toLowerCase();
          return hay.includes(q);
        })
      : rows;
    return sortCallsLatestFirst(base);
  }, [rows, deferredQuery]);

  const grouped = useMemo(() => groupCallSessionsByDay(filtered), [filtered]);

  const loadTranscript = useCallback(async (voiceId: string, before?: string) => {
    const gen = ++loadGenRef.current;
    setTranscriptLoading(true);
    try {
      const page = await sessions.getMessagesPage(voiceId, { limit: 40, before });
      if (gen !== loadGenRef.current) return;
      const mapped = mapCallHistoryMessages(page.messages ?? []);
      if (page.messages?.length) {
        oldestIdRef.current = page.messages[0]?.id ?? oldestIdRef.current;
      }
      setHasMore(Boolean(page.hasMore));
      setTranscript((prev) => {
        if (!before) return mapped;
        const existing = new Set(prev.map((l) => l.id));
        const older = mapped.filter((l) => !existing.has(l.id));
        return [...older, ...prev];
      });
    } catch {
      if (gen !== loadGenRef.current) return;
      if (!before) setTranscript([]);
    } finally {
      if (gen === loadGenRef.current) setTranscriptLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selected || selected.kind !== 'crew') {
      setTranscript([]);
      setHasMore(false);
      oldestIdRef.current = null;
      return;
    }
    oldestIdRef.current = null;
    setTranscript([]);
    void loadTranscript(selected.crew.id);
  }, [selected, loadTranscript]);

  const onSelect = useCallback((id: string) => {
    startTransition(() => setSelectedId(id));
  }, [startTransition]);

  const onCallAgain = useCallback(() => {
    if (!selected || selected.kind !== 'crew') return;
    const target = crewCallTargetFromVoiceSession(selected.crew);
    if (!target) return;
    startCall(target);
  }, [selected, startCall]);

  const onRequestDelete = useCallback((id: string) => {
    setDeleteError(null);
    setDeleteId(id);
  }, []);

  const onConfirmDelete = useCallback(async () => {
    if (!deleteId) return;
    const target = rows.find((r) => r.id === deleteId);
    if (!target || target.kind !== 'crew') {
      setDeleteId(null);
      return;
    }
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await crewChat.deleteVoiceSession(target.crew.id);
      const removedId = deleteId;
      setDeleteId(null);
      setRows((prev) => {
        const next = prev.filter((r) => r.id !== removedId);
        setSelectedId((cur) => {
          if (cur !== removedId) return cur;
          return next[0]?.id ?? null;
        });
        return next;
      });
      if (selectedId === removedId) {
        setTranscript([]);
        setHasMore(false);
        oldestIdRef.current = null;
      }
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to delete call');
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteId, selectedId, rows]);

  const pendingDelete = useMemo(
    () => (deleteId ? rows.find((r) => r.id === deleteId) ?? null : null),
    [deleteId, rows],
  );

  const onSearchKey = useCallback((e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') setQuery('');
  }, []);

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: colors.bg.primary,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          px: 3,
          py: 2,
          borderBottom: `1px solid ${colors.border.default}`,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          flexShrink: 0,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: colors.accent.green }} />
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: '0.7rem',
              fontWeight: 700,
              color: colors.accent.green,
              letterSpacing: '3px',
            }}
          >
            CALLS
          </Typography>
        </Box>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: colors.text.dim }}>
          {rows.length} SHOWN
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Refresh" arrow>
          <IconButton
            size="small"
            onClick={() => { void loadList(); }}
            disabled={listLoading}
            sx={{
              width: 30,
              height: 30,
              borderRadius: '4px',
              color: colors.text.secondary,
              border: `1px solid ${colors.border.default}`,
              '&:hover': { color: colors.text.primary, bgcolor: colors.bg.hover },
            }}
          >
            <RefreshIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
        <Button
          size="small"
          startIcon={<AddIcCallIcon sx={{ fontSize: 12 }} />}
          onClick={() => setPhonebookOpen(true)}
          sx={{
            color: colors.accent.blue,
            fontSize: '0.6rem',
            textTransform: 'none',
            fontFamily: MONO,
            border: `1px solid ${alphaColor(colors.accent.blue, 0.3)}`,
            px: 1.5,
            py: 0.4,
            borderRadius: '4px',
            '&:hover': { bgcolor: alphaColor(colors.accent.blue, 0.15), borderColor: alphaColor(colors.accent.blue, 0.6) },
          }}
        >
          NEW CALL
        </Button>
      </Box>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: `${PANEL_SIDE_LIST_WIDTH}px 1fr` },
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            borderRight: { md: `1px solid ${colors.border.default}` },
            overflow: 'hidden',
            bgcolor: colors.bg.secondary,
          }}
        >
          <Box
            sx={{
              px: 1.25,
              py: 0.85,
              borderBottom: `1px solid ${colors.border.default}`,
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              flexShrink: 0,
            }}
          >
            <SearchIcon sx={{ fontSize: 14, color: colors.text.dim }} />
            <InputBase
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder="Filter callsign / name"
              sx={{
                flex: 1,
                fontFamily: MONO,
                fontSize: '0.65rem',
                color: colors.text.primary,
                '& input::placeholder': { color: colors.text.dim, opacity: 1 },
              }}
            />
          </Box>

          <Box className="ax-scroll-y" sx={{ flex: 1, minHeight: 0 }}>
            {listLoading && rows.length === 0 ? (
              <Box sx={{ py: 4, display: 'flex', justifyContent: 'center' }}>
                <CircularProgress size={18} sx={{ color: colors.text.dim }} />
              </Box>
            ) : listError ? (
              <Typography sx={{ p: 2, fontFamily: MONO, fontSize: '0.6rem', color: colors.accent.red }}>
                {listError}
              </Typography>
            ) : filtered.length === 0 ? (
              <Box sx={{ p: 2.5, textAlign: 'center' }}>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: colors.text.dim, mb: 1.5 }}>
                  {rows.length === 0 ? 'No calls yet' : 'No matches'}
                </Typography>
                {rows.length === 0 && (
                  <Button
                    size="small"
                    startIcon={<AddIcCallIcon sx={{ fontSize: 14 }} />}
                    onClick={() => setPhonebookOpen(true)}
                    sx={{
                      fontFamily: MONO,
                      fontSize: '0.55rem',
                      letterSpacing: '0.08em',
                      color: colors.accent.blue,
                      border: `1px solid ${alphaColor(colors.accent.blue, 0.4)}`,
                    }}
                  >
                    New Call
                  </Button>
                )}
              </Box>
            ) : (
              grouped.map((group, groupIdx) => (
                <Box key={group.dayKey || `ungrouped-${groupIdx}`}>
                  {group.label ? (
                    <DateGroupDivider label={group.label} first={groupIdx === 0} />
                  ) : null}
                  {group.items.map((row) => (
                    <CallRow
                      key={row.id}
                      row={row}
                      selected={row.id === selectedId}
                      onSelect={onSelect}
                      onRequestDelete={onRequestDelete}
                    />
                  ))}
                </Box>
              ))
            )}
          </Box>
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', bgcolor: colors.bg.primary }}>
          {selected ? (
            <>
              <Box
                sx={{
                  px: 2,
                  py: 1.1,
                  borderBottom: `1px solid ${colors.border.default}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  flexShrink: 0,
                }}
              >
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography
                    noWrap
                    sx={{ fontFamily: MONO, fontSize: '0.8rem', fontWeight: 700, color: colors.text.primary }}
                  >
                    {selected.kind === 'crew'
                      ? (selected.crew.hostCrewName ?? selected.crew.title ?? 'Unknown')
                      : (selected.voip.from && selected.voip.to ? `${selected.voip.from} → ${selected.voip.to}` : selected.voip.providerId)}
                  </Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.52rem', color: colors.text.dim }}>
                    {selected.kind === 'crew' ? (
                      <>
                        @{selected.crew.hostCrewCallsign ?? 'crew'}
                        {selected.crew.hostCrewTitle ? ` · ${selected.crew.hostCrewTitle}` : ''}
                        {' · '}
                        {relativeTime(selected.crew.updatedAt ?? selected.crew.createdAt)}
                      </>
                    ) : (
                      <>
                        VOIP · {selected.voip.direction} · {selected.voip.state}
                        {' · '}
                        {relativeTime(selected.voip.startedAt ?? selected.voip.endedAt ?? undefined)}
                      </>
                    )}
                  </Typography>
                </Box>
                {selected.kind === 'crew' && (
                  <Tooltip title="Delete call & transcript" arrow>
                    <span>
                      <IconButton
                        size="small"
                        aria-label="Delete call"
                        onClick={() => onRequestDelete(selected.id)}
                        disabled={deleteBusy}
                        sx={{
                          width: 32,
                          height: 32,
                          borderRadius: '4px',
                          color: colors.text.dim,
                          border: `1px solid ${colors.border.default}`,
                          '&:hover': {
                            color: colors.accent.red,
                            borderColor: alphaColor(colors.accent.red, 0.5),
                            bgcolor: alphaColor(colors.accent.red, 0.1),
                          },
                        }}
                      >
                        <DeleteOutlineIcon sx={{ fontSize: 15 }} />
                      </IconButton>
                    </span>
                  </Tooltip>
                )}
                {selected.kind === 'crew' && (
                  <Button
                    size="small"
                    startIcon={<CallIcon sx={{ fontSize: 14 }} />}
                    onClick={onCallAgain}
                    disabled={isActive}
                    sx={{
                      height: 32,
                      px: 1.35,
                      fontFamily: MONO,
                      fontSize: '0.58rem',
                      letterSpacing: '0.08em',
                      fontWeight: 700,
                      color: selectedAccent,
                      bgcolor: alphaColor(selectedAccent, 0.12),
                      border: `1px solid ${alphaColor(selectedAccent, 0.4)}`,
                      borderRadius: '4px',
                      '&:hover': { bgcolor: alphaColor(selectedAccent, 0.2) },
                      '&.Mui-disabled': { opacity: 0.4 },
                    }}
                  >
                    CALL AGAIN
                  </Button>
                )}
              </Box>

              {selected.kind === 'crew' ? (
                <>
                  {hasMore && (
                    <Box sx={{ px: 2, py: 0.6, borderBottom: `1px solid ${colors.border.default}`, flexShrink: 0 }}>
                      <Button
                        size="small"
                        disabled={transcriptLoading || !oldestIdRef.current}
                        onClick={() => {
                          if (selected.kind !== 'crew' || !oldestIdRef.current) return;
                          void loadTranscript(selected.crew.id, oldestIdRef.current);
                        }}
                        sx={{
                          fontFamily: MONO,
                          fontSize: '0.5rem',
                          letterSpacing: '0.08em',
                          color: selectedAccent,
                          minWidth: 0,
                          py: 0.15,
                        }}
                      >
                        {transcriptLoading ? 'LOADING…' : 'EARLIER'}
                      </Button>
                    </Box>
                  )}

                  <TranscriptBody
                    lines={transcript}
                    speakerName={selected.crew.hostCrewName?.trim() || selected.crew.hostCrewCallsign || 'Crew'}
                    accent={selectedAccent}
                    loading={transcriptLoading}
                  />
                </>
              ) : (
                <VoipDetailBody call={selected.voip} accent={selectedAccent} />
              )}
            </>
          ) : (
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, px: 3 }}>
              <PhoneInTalkIcon sx={{ fontSize: 28, color: colors.text.dim }} />
              <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: colors.text.dim, textAlign: 'center' }}>
                Select a call to inspect its transcript
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      <Dialog
        open={Boolean(deleteId)}
        onClose={() => { if (!deleteBusy) setDeleteId(null); }}
        PaperProps={{
          sx: {
            bgcolor: colors.bg.secondary,
            border: `1px solid ${colors.border.default}`,
            borderRadius: 1,
            maxWidth: 420,
            width: '90%',
          },
        }}
      >
        <DialogTitle
          sx={{
            fontFamily: MONO,
            fontSize: '0.8rem',
            fontWeight: 700,
            letterSpacing: '1px',
            pb: 1,
          }}
        >
          DELETE CALL
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ color: colors.text.secondary, fontSize: '0.72rem', lineHeight: 1.65, mb: 1 }}>
            Permanently remove
            {' '}
            <Box component="span" sx={{ color: colors.text.primary, fontWeight: 600 }}>
              {pendingDelete?.kind === 'crew'
                ? (pendingDelete.crew.hostCrewName ?? pendingDelete.crew.title ?? 'this call')
                : 'this call'}
            </Box>
            {' '}
            from history, including its full transcript. This cannot be undone.
          </Typography>
          {deleteError && (
            <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: colors.accent.red, mt: 1 }}>
              {deleteError}
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button
            onClick={() => setDeleteId(null)}
            disabled={deleteBusy}
            size="small"
            sx={{
              color: colors.text.dim,
              textTransform: 'none',
              fontSize: '0.65rem',
              fontFamily: MONO,
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => { void onConfirmDelete(); }}
            disabled={deleteBusy}
            size="small"
            startIcon={deleteBusy ? <CircularProgress size={12} sx={{ color: colors.bg.primary }} /> : undefined}
            sx={{
              color: colors.bg.primary,
              bgcolor: colors.accent.red,
              textTransform: 'none',
              fontSize: '0.65rem',
              fontFamily: MONO,
              fontWeight: 700,
              '&:hover': { bgcolor: alphaColor(colors.accent.red, 0.85) },
              '&.Mui-disabled': { opacity: 0.55 },
            }}
          >
            {deleteBusy ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      <CrewCallPhonebookModal open={phonebookOpen} onClose={() => setPhonebookOpen(false)} />
    </Box>
  );
}
