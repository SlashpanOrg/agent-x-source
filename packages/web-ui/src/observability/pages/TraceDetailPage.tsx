/** Trace detail page (§11.5) — HUD header + stats + minimap + waterfall + SpanDetail + LogsPanel + MetricsPanel. */
import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SearchIcon from '@mui/icons-material/Search';
import type { TraceDetail, SpanNode, ObservabilityLogEntry } from '@agentx/shared';
import { getTrace, getTraceLogs } from '../api';
import { useObs } from '../context';
import { obs, obsMonoSx, obsOverlineSx, obsPanelSx } from '../obs-theme';
import { alphaColor } from '../../theme';
import { StatusBadge } from '../components/StatusBadge';
import { CopyButton } from '../components/CopyButton';
import { SpanKindLegend } from '../components/SpanKindLegend';
import { TraceMiniMap } from '../components/TraceMiniMap';
import { SpanWaterfall } from '../components/SpanWaterfall';
import { SpanDetail } from '../components/SpanDetail';
import { LogsPanel } from '../components/LogsPanel';
import { MetricsPanel } from '../components/MetricsPanel';
import { FindInTrace } from '../components/FindInTrace';
import { TraceExportBar } from '../components/TraceExportBar';
import { TurnReplay } from '../components/TurnReplay';

export function TraceDetailPage() {
  const { traceId } = useParams<{ traceId: string }>();
  const { domain, refreshTick } = useObs();
  const [trace, setTrace] = useState<TraceDetail | null>(null);
  const [logs, setLogs] = useState<ObservabilityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedSpan, setSelectedSpan] = useState<SpanNode | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findMatches, setFindMatches] = useState<Set<string>>(new Set());
  const [currentMatch, setCurrentMatch] = useState(0);
  const [kindFilter] = useState<Set<string>>(new Set());
  const [showCriticalPath, setShowCriticalPath] = useState(false);
  const [viewport, setViewport] = useState<{ start: number; end: number } | null>(null);
  const [replayOpen, setReplayOpen] = useState(false);

  const load = useCallback(async () => {
    if (!traceId) return;
    setLoading(true);
    setError('');
    try {
      const [t, l] = await Promise.all([
        getTrace(traceId),
        getTraceLogs(traceId, { limit: 500 }),
      ]);
      setTrace(t);
      setLogs(l.logs);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [traceId]);

  useEffect(() => { load(); }, [load, refreshTick]);

  const allSpans = useMemo(() => {
    if (!trace) return [];
    const result: SpanNode[] = [];
    const walk = (s: SpanNode) => { result.push(s); s.children?.forEach(walk); };
    trace.spans.forEach(walk);
    return result;
  }, [trace]);

  const timeBounds = useMemo(() => {
    if (allSpans.length === 0) return { start: 0, end: 1 };
    const starts = allSpans.map((s) => new Date(s.started_at).getTime());
    const ends = allSpans.map((s) => s.ended_at ? new Date(s.ended_at).getTime() : 0);
    return { start: Math.min(...starts), end: Math.max(...ends) };
  }, [allSpans]);

  useEffect(() => {
    if (trace) setViewport({ start: timeBounds.start, end: timeBounds.end });
  }, [trace?.trace_id, timeBounds.start, timeBounds.end]);

  useEffect(() => {
    if (!findQuery) { setFindMatches(new Set()); return; }
    const q = findQuery.toLowerCase();
    const matches = new Set<string>();
    for (const s of allSpans) {
      if (s.name.toLowerCase().includes(q)) matches.add(s.span_id);
      else if (JSON.stringify(s.attributes ?? {}).toLowerCase().includes(q)) matches.add(s.span_id);
    }
    setFindMatches(matches);
    setCurrentMatch(0);
  }, [findQuery, allSpans]);

  const matchList = useMemo(() => allSpans.filter((s) => findMatches.has(s.span_id)), [allSpans, findMatches]);

  const scrollToMatch = useCallback((idx: number) => {
    const span = matchList[idx];
    if (!span) return;
    const el = document.querySelector(`[data-span-id="${span.span_id}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setSelectedSpan(span);
  }, [matchList]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <CircularProgress size={28} thickness={3} sx={{ color: obs.accent.hud }} />
      </Box>
    );
  }
  if (error) return <Alert severity="error" sx={{ bgcolor: obs.bg.panel, color: obs.text.primary, border: `1px solid ${obs.accent.alert}` }}>{error}</Alert>;
  if (!trace) return <Alert severity="error" sx={{ bgcolor: obs.bg.panel, color: obs.text.primary, border: `1px solid ${obs.accent.alert}` }}>Trace not found.</Alert>;

  const t = trace;
  const stats = {
    spanCount: allSpans.length,
    errorCount: allSpans.filter((s) => s.status === 'error').length,
    depth: Math.max(...allSpans.map((s) => s.name.split('→').length)),
    inputTokens: t.input_tokens ?? 0,
    outputTokens: t.output_tokens ?? 0,
    cost: t.cost_usd ?? 0,
    tools: t.tool_call_count ?? 0,
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, pb: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
        <IconButton component={Link} to="/" size="small" sx={{ color: obs.text.dim }}><ArrowBackIcon fontSize="small" /></IconButton>
        <Typography sx={{ ...obsOverlineSx, fontSize: '0.72rem', color: obs.text.primary, letterSpacing: '2px' }}>Trace Detail</Typography>
        <Typography sx={{ ...obsMonoSx, fontSize: '0.64rem', color: obs.text.secondary }}>{t.trace_id}</Typography>
        <CopyButton text={t.trace_id} />
        <StatusBadge status={t.status} />
        {t.session_id && (
          <Chip
            size="small"
            label={t.session_id.slice(0, 8)}
            component={Link}
            to={`/session/${t.session_id}`}
            clickable
            sx={{ ...obsMonoSx, fontSize: '0.58rem', color: obs.accent.hud, borderColor: obs.accent.hud, bgcolor: alphaColor(obs.accent.hud, 0.08) }}
          />
        )}
        <Box sx={{ flexGrow: 1 }} />
        <TraceExportBar traceId={t.trace_id} trace={t} capturePrompts={false} />
      </Box>

      {/* Stats */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 1 }}>
        <StatTile label="Started" value={new Date(t.started_at).toLocaleString()} />
        <StatTile label="Duration" value={t.duration_ms != null ? `${t.duration_ms}ms` : '—'} />
        <StatTile label="Spans" value={stats.spanCount} />
        <StatTile label="Errors" value={stats.errorCount} accent={stats.errorCount > 0 ? obs.accent.alert : undefined} />
        <StatTile label="Tokens" value={`${stats.inputTokens}→${stats.outputTokens}`} />
        {t.cost_usd != null && <StatTile label="Cost" value={`$${t.cost_usd.toFixed(4)}`} />}
        {t.tool_call_count != null && <StatTile label="Tools" value={t.tool_call_count} />}
      </Box>
      {t.error && (
        <Alert severity="error" sx={{ bgcolor: obs.bg.panel, color: obs.text.primary, border: `1px solid ${obs.accent.alert}`, fontSize: 12 }}>{t.error}</Alert>
      )}

      {/* Minimap */}
      {viewport && (
        <Box sx={obsPanelSx()}>
          <TraceMiniMap
            spans={allSpans}
            traceStart={timeBounds.start}
            traceEnd={timeBounds.end}
            viewport={viewport}
            onViewportChange={setViewport}
            height={40}
          />
        </Box>
      )}

      {/* Controls */}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <SpanKindLegend domain={domain} />
        <Box sx={{ flexGrow: 1 }} />
        <ToggleButtonGroup size="small" value={showCriticalPath ? 'crit' : undefined}>
          <ToggleButton
            value="crit"
            selected={showCriticalPath}
            onClick={() => setShowCriticalPath((v) => !v)}
            sx={{ px: 1, py: 0.25, fontSize: '0.6rem', textTransform: 'uppercase', color: obs.text.dim, borderColor: obs.border.hud }}
          >
            Critical Path
          </ToggleButton>
          <ToggleButton
            value="replay"
            selected={replayOpen}
            onClick={() => setReplayOpen((v) => !v)}
            sx={{ px: 1, py: 0.25, fontSize: '0.6rem', textTransform: 'uppercase', color: obs.text.dim, borderColor: obs.border.hud }}
          >
            Replay
          </ToggleButton>
        </ToggleButtonGroup>
        <Tooltip title="Find (Ctrl+F)">
          <IconButton size="small" onClick={() => setFindOpen((v) => !v)} sx={{ color: findOpen ? obs.accent.hud : obs.text.dim }}>
            <SearchIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {findOpen && (
        <FindInTrace
          matches={matchList.length}
          currentMatch={currentMatch + 1}
          onQueryChange={setFindQuery}
          onPrev={() => { const idx = (currentMatch - 1 + matchList.length) % matchList.length; setCurrentMatch(idx); scrollToMatch(idx); }}
          onNext={() => { const idx = (currentMatch + 1) % matchList.length; setCurrentMatch(idx); scrollToMatch(idx); }}
          onClose={() => { setFindOpen(false); setFindQuery(''); }}
        />
      )}

      {replayOpen && (
        <Box sx={obsPanelSx()}>
          <TurnReplay
            spans={trace.spans}
            logs={logs}
            traceStart={timeBounds.start}
            traceEnd={timeBounds.end}
            onClose={() => setReplayOpen(false)}
          />
        </Box>
      )}

      {/* Waterfall */}
      <Box sx={obsPanelSx()}>
        <Box className="ax-scroll" sx={{ overflow: 'auto' }}>
          <SpanWaterfall
            spans={trace.spans}
            traceStart={timeBounds.start}
            traceEnd={timeBounds.end}
            selectedSpanId={selectedSpan?.span_id}
            onSelectSpan={setSelectedSpan}
            findQuery={findQuery}
            findMatches={findMatches}
            currentMatchIdx={currentMatch}
            kindFilter={kindFilter}
            showCriticalPath={showCriticalPath}
          />
        </Box>
      </Box>

      <LogsPanel logs={logs} traceStart={timeBounds.start} onLogClick={(l) => {
        if (l.span_id) {
          const span = allSpans.find((s) => s.span_id === l.span_id);
          if (span) setSelectedSpan(span);
        }
      }} />
      <MetricsPanel spans={allSpans} />

      <SpanDetail
        span={selectedSpan}
        traceId={t.trace_id}
        logs={logs}
        onClose={() => setSelectedSpan(null)}
        onSelectSpan={setSelectedSpan}
      />
    </Box>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  const color = accent ?? obs.text.primary;
  return (
    <Box sx={{ ...obsPanelSx(accent), p: 1, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      <Typography sx={{ ...obsMonoSx, fontSize: '0.52rem', color: obs.text.dim, textTransform: 'uppercase', letterSpacing: '0.8px' }}>{label}</Typography>
      <Typography sx={{ ...obsMonoSx, fontSize: '0.72rem', color, fontWeight: 600 }}>{value}</Typography>
    </Box>
  );
}
