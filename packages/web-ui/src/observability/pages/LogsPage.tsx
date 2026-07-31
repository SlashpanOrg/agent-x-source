/** Logs page (§11.6) — histogram + filter bar + virtualized log list. */
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import ToggleButton from '@mui/material/ToggleButton';
import SubjectIcon from '@mui/icons-material/Subject';
import type { ObservabilityLogEntry } from '@agentx/shared';
import { listLogs } from '../api';
import { useObs } from '../context';
import { LogHistogram } from '../components/LogHistogram';
import { LogRow } from '../components/LogRow';
import { VirtualList } from '../components/VirtualList';
import { FilterChips } from '../components/FilterChips';
import { ObsPanel, ObsPageHeader } from '../components/ObsPanel';
import { obs, obsMonoSx, obsBtnGhostSx, obsInputSx, LOG_LEVEL_COLORS } from '../obs-theme';
import { alphaColor } from '../../theme';

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export function LogsPage() {
  const navigate = useNavigate();
  const { domain, timeRange, refreshTick } = useObs();
  const [logs, setLogs] = useState<ObservabilityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);

  // Filters
  const [levelFilter, setLevelFilter] = useState<string[]>([]);
  const [scopeFilter, setScopeFilter] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [traceId, setTraceId] = useState('');
  const [query, setQuery] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);

  const fetchLogs = useCallback(async (reset: boolean) => {
    setLoading(reset);
    setError('');
    try {
      const res = await listLogs({
        domain: domain === 'both' ? undefined : domain,
        sessionId: sessionId || undefined,
        traceId: traceId || undefined,
        level: errorsOnly ? 'error' : (levelFilter.length > 0 ? levelFilter.join(',') : undefined),
        scope: scopeFilter || undefined,
        from: timeRange.from,
        to: timeRange.to,
        q: query || undefined,
        limit: 100,
        cursor: reset ? undefined : cursor,
      });
      if (reset) setLogs(res.logs);
      else setLogs((prev) => [...prev, ...res.logs]);
      setCursor(res.nextCursor);
      setHasMore(!!res.nextCursor);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [domain, sessionId, traceId, levelFilter, scopeFilter, errorsOnly, query, timeRange, cursor]);

  useEffect(() => {
    setCursor(undefined);
    fetchLogs(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, timeRange.from, timeRange.to, sessionId, traceId, levelFilter, scopeFilter, errorsOnly, query, refreshTick]);

  const resetFilters = () => { setLevelFilter([]); setScopeFilter(''); setSessionId(''); setTraceId(''); setQuery(''); setErrorsOnly(false); };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <ObsPageHeader icon={<SubjectIcon sx={{ fontSize: 18 }} />} title="Logs" subtitle={`${logs.length} entries loaded`} />

      {/* Histogram */}
      <ObsPanel title="Log Volume" subtitle="Level distribution over the selected range">
        {logs.length > 0 ? (
          <LogHistogram logs={logs} from={timeRange.from} to={timeRange.to} />
        ) : (
          <Typography sx={{ ...obsMonoSx, fontSize: '0.65rem', color: obs.text.dim }}>No logs in range.</Typography>
        )}
      </ObsPanel>

      {/* Filter bar */}
      <ObsPanel>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <FilterChips options={LEVELS} selected={levelFilter} onChange={setLevelFilter} label="Level" colors={LOG_LEVEL_COLORS} />
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
            <TextField size="small" placeholder="Scope" value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)} sx={{ width: 120, ...obsInputSx }} />
            <TextField size="small" placeholder="Session ID" value={sessionId} onChange={(e) => setSessionId(e.target.value)} sx={{ width: 150, ...obsInputSx }} />
            <TextField size="small" placeholder="Trace ID" value={traceId} onChange={(e) => setTraceId(e.target.value)} sx={{ width: 150, ...obsInputSx }} />
            <TextField size="small" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} sx={{ width: 150, ...obsInputSx }} />
            <Button size="small" onClick={resetFilters} sx={obsBtnGhostSx}>Reset</Button>
          </Box>
        </Box>
      </ObsPanel>

      {error && <Alert severity="error">{error}</Alert>}

      {/* Log list */}
      <ObsPanel noBodyPadding>
        {loading && logs.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress size={22} sx={{ color: obs.accent.hud }} /></Box>
        ) : logs.length === 0 ? (
          <Typography sx={{ ...obsMonoSx, fontSize: '0.68rem', color: obs.text.dim, py: 3, textAlign: 'center', display: 'block' }}>
            No logs found. Try adjusting filters.
          </Typography>
        ) : (
          <>
            <VirtualList
              items={logs}
              itemHeight={28}
              height={500}
              renderItem={(log) => (
                <Box sx={{ height: 28 }}>
                  <LogRow
                    log={log}
                    onTraceClick={(tid) => navigate(`/trace/${tid}`)}
                  />
                </Box>
              )}
            />
            {hasMore && (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 1 }}>
                <Button size="small" onClick={() => fetchLogs(false)} disabled={loading} sx={obsBtnGhostSx}>
                  Load more
                </Button>
              </Box>
            )}
            <Typography sx={{ ...obsMonoSx, fontSize: '0.6rem', color: obs.text.dim, display: 'block', textAlign: 'center', py: 1 }}>
              Showing {logs.length} log{logs.length !== 1 ? 's' : ''}
            </Typography>
          </>
        )}
      </ObsPanel>
    </Box>
  );
}
