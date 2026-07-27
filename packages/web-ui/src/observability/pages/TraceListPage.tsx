/** Trace list page (§11.4) — filter bar + results table + pagination + auto-refresh. */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import Skeleton from '@mui/material/Skeleton';
import Alert from '@mui/material/Alert';
import ToggleButton from '@mui/material/ToggleButton';
import TimelineIcon from '@mui/icons-material/Timeline';
import { listTraces, type ListTracesResponse } from '../api';
import type { TraceSummary } from '@agentx/shared';
import { useObs } from '../context';
import { StatusBadge } from '../components/StatusBadge';
import { DomainBadge } from '../components/DomainToggle';
import { FilterChips } from '../components/FilterChips';
import { ObsPanel, ObsPageHeader } from '../components/ObsPanel';
import { obs, obsMonoSx, obsBtnGhostSx, obsInputSx } from '../obs-theme';
import { alphaColor } from '../../theme';

const STATUSES = ['running', 'ok', 'error', 'cancelled'] as const;
const AGENT_KINDS = ['turn', 'autonomous_run', 'crew_mission', 'task_executor'] as const;
const APP_KINDS = ['http_request', 'ws_connection', 'auth', 'db_query', 'channel_event', 'automation_run', 'startup', 'integration_call', 'job'] as const;

type SortField = 'started_at' | 'duration_ms' | 'input_tokens' | 'output_tokens' | 'tool_call_count';
type SortDir = 'asc' | 'desc';

export function TraceListPage() {
  const navigate = useNavigate();
  const { domain, timeRange, refreshTick } = useObs();
  const [data, setData] = useState<ListTracesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [allTraces, setAllTraces] = useState<TraceSummary[]>([]);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [kindFilter, setKindFilter] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [query, setQuery] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [sortField, setSortField] = useState<SortField>('started_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const kinds = domain === 'agent' ? AGENT_KINDS : domain === 'app' ? APP_KINDS : [...AGENT_KINDS, ...APP_KINDS];

  const fetchTraces = useCallback(async (reset: boolean) => {
    setLoading(reset);
    setError('');
    try {
      const res = await listTraces({
        domain: domain === 'both' ? undefined : domain,
        sessionId: sessionId || undefined,
        status: errorsOnly ? 'error' : (statusFilter.length === 1 ? statusFilter[0] : undefined),
        kind: kindFilter.length === 1 ? kindFilter[0] : undefined,
        from: timeRange.from,
        to: timeRange.to,
        q: query || undefined,
        limit: 50,
        cursor: reset ? undefined : cursor,
      });
      if (reset) {
        setAllTraces(res.traces);
      } else {
        setAllTraces((prev) => [...prev, ...res.traces]);
      }
      setData(res);
      setCursor(res.nextCursor);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [domain, sessionId, statusFilter, kindFilter, errorsOnly, query, timeRange, cursor]);

  // Initial load + filter changes.
  useEffect(() => {
    setCursor(undefined);
    fetchTraces(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, timeRange.from, timeRange.to, sessionId, statusFilter, kindFilter, errorsOnly, query, refreshTick]);

  // Sort the traces in-memory.
  const sortedTraces = useMemo(() => {
    const sorted = [...allTraces];
    sorted.sort((a, b) => {
      const av = a[sortField] ?? 0;
      const bv = b[sortField] ?? 0;
      const cmp = (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [allTraces, sortField, sortDir]);

  const maxDuration = useMemo(() => Math.max(1, ...sortedTraces.map((t) => t.duration_ms ?? 0)), [sortedTraces]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const resetFilters = () => { setStatusFilter([]); setKindFilter([]); setSessionId(''); setQuery(''); setErrorsOnly(false); };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <ObsPageHeader
        icon={<TimelineIcon sx={{ fontSize: 18 }} />}
        title="Traces"
        subtitle={data ? `${sortedTraces.length} result${sortedTraces.length !== 1 ? 's' : ''} in range` : undefined}
      />

      {/* Filter bar */}
      <ObsPanel>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <FilterChips options={STATUSES} selected={statusFilter} onChange={setStatusFilter} label="Status" />
            <FilterChips options={kinds as unknown as string[]} selected={kindFilter} onChange={setKindFilter} label="Kind" />
            <ToggleButton
              size="small"
              value="errors"
              selected={errorsOnly}
              onChange={(_, v) => setErrorsOnly(v)}
              sx={{
                px: 1.25, color: errorsOnly ? obs.accent.alert : obs.text.dim,
                bgcolor: errorsOnly ? alphaColor(obs.accent.alert, 0.12) : 'transparent',
                border: `1px solid ${errorsOnly ? alphaColor(obs.accent.alert, 0.4) : obs.border.default}`,
              }}
            >
              Errors only
            </ToggleButton>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <TextField
              size="small" placeholder="Session ID" value={sessionId}
              onChange={(e) => setSessionId(e.target.value)} sx={{ width: 200, ...obsInputSx }}
            />
            <TextField
              size="small" placeholder="Search traces…" value={query}
              onChange={(e) => setQuery(e.target.value)} sx={{ width: 200, ...obsInputSx }}
            />
            <Button size="small" onClick={resetFilters} sx={obsBtnGhostSx}>Reset filters</Button>
          </Box>
        </Box>
      </ObsPanel>

      {error && <Alert severity="error">{error}</Alert>}

      {/* Results */}
      <ObsPanel noBodyPadding>
        <Box className="ax-scroll-x">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Domain</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>
                  <TableSortLabel active={sortField === 'started_at'} direction={sortDir} onClick={() => handleSort('started_at')}>
                    Started
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel active={sortField === 'duration_ms'} direction={sortDir} onClick={() => handleSort('duration_ms')}>
                    Duration
                  </TableSortLabel>
                </TableCell>
                <TableCell>Kind</TableCell>
                <TableCell>Session</TableCell>
                <TableCell>Tokens</TableCell>
                <TableCell>Tool calls</TableCell>
                <TableCell>Error</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && allTraces.length === 0 ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 9 }).map((_, j) => (
                      <TableCell key={j}><Skeleton height={18} sx={{ bgcolor: obs.bg.hud }} /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : sortedTraces.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} align="center">
                    <Typography sx={{ ...obsMonoSx, fontSize: '0.68rem', color: obs.text.dim, py: 3 }}>
                      No traces found. Try adjusting filters.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                sortedTraces.map((t) => (
                  <TableRow
                    key={t.trace_id}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/trace/${t.trace_id}`)}
                  >
                    <TableCell><DomainBadge domain={t.domain} /></TableCell>
                    <TableCell><StatusBadge status={t.status} /></TableCell>
                    <TableCell sx={obsMonoSx} title={new Date(t.started_at).toISOString()}>
                      {new Date(t.started_at).toLocaleTimeString()}
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box component="span" sx={{ ...obsMonoSx, fontSize: '0.68rem', minWidth: 46 }}>
                          {t.duration_ms != null ? `${t.duration_ms}ms` : '—'}
                        </Box>
                        {t.duration_ms != null && (
                          <Box sx={{ width: 40, height: 3, bgcolor: obs.border.default, borderRadius: 2, overflow: 'hidden' }}>
                            <Box sx={{ width: `${(t.duration_ms / maxDuration) * 100}%`, height: '100%', bgcolor: obs.accent.hud }} />
                          </Box>
                        )}
                      </Box>
                    </TableCell>
                    <TableCell sx={{ ...obsMonoSx, fontSize: '0.65rem' }}>{t.kind}</TableCell>
                    <TableCell>
                      {t.session_id ? (
                        <Chip
                          size="small"
                          label={t.session_id.slice(0, 8)}
                          onClick={(e) => { e.stopPropagation(); navigate(`/session/${t.session_id}`); }}
                          sx={{ ...obsMonoSx, fontSize: '0.62rem', bgcolor: obs.bg.hud, border: `1px solid ${obs.border.default}` }}
                        />
                      ) : '—'}
                    </TableCell>
                    <TableCell sx={obsMonoSx}>{(t.input_tokens ?? 0) + (t.output_tokens ?? 0)}</TableCell>
                    <TableCell sx={obsMonoSx}>{t.tool_call_count ?? 0}</TableCell>
                    <TableCell>
                      {t.status === 'error' && t.error ? (
                        <Typography sx={{ ...obsMonoSx, fontSize: '0.62rem', color: obs.accent.alert, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.error}
                        </Typography>
                      ) : '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Box>
      </ObsPanel>

      {/* Pagination */}
      {cursor && (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Button size="small" onClick={() => fetchTraces(false)} disabled={loading} sx={obsBtnGhostSx}>
            Load more
          </Button>
        </Box>
      )}
      {data && (
        <Typography sx={{ ...obsMonoSx, fontSize: '0.6rem', color: obs.text.dim, textAlign: 'center' }}>
          Showing {sortedTraces.length} trace{sortedTraces.length !== 1 ? 's' : ''}
        </Typography>
      )}
    </Box>
  );
}
