/** Session traces page — traces for a specific session (§11.2 route). */
import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import GroupWorkIcon from '@mui/icons-material/GroupWork';
import { getSessionTraces } from '../api';
import type { TraceSummary } from '@agentx/shared';
import { StatusBadge } from '../components/StatusBadge';
import { ObsPanel, ObsPageHeader } from '../components/ObsPanel';
import { obs, obsMonoSx } from '../obs-theme';

export function SessionTracesPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    getSessionTraces(sessionId)
      .then((r) => setTraces(r.traces))
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress size={24} sx={{ color: obs.accent.hud }} /></Box>;
  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <ObsPageHeader
        icon={<GroupWorkIcon sx={{ fontSize: 18 }} />}
        title="Session"
        subtitle={`${sessionId} · ${traces.length} trace${traces.length !== 1 ? 's' : ''}`}
      />
      <ObsPanel noBodyPadding>
        <Box className="ax-scroll-x">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Status</TableCell>
                <TableCell>Kind</TableCell>
                <TableCell>Started</TableCell>
                <TableCell>Duration</TableCell>
                <TableCell>Tokens</TableCell>
                <TableCell>Tool calls</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {traces.map((t) => (
                <TableRow
                  key={t.trace_id}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/trace/${t.trace_id}`)}
                >
                  <TableCell><StatusBadge status={t.status} /></TableCell>
                  <TableCell sx={{ ...obsMonoSx, fontSize: '0.65rem' }}>{t.kind}</TableCell>
                  <TableCell sx={obsMonoSx}>{new Date(t.started_at).toLocaleString()}</TableCell>
                  <TableCell sx={obsMonoSx}>{t.duration_ms != null ? `${t.duration_ms}ms` : '—'}</TableCell>
                  <TableCell sx={obsMonoSx}>{(t.input_tokens ?? 0) + (t.output_tokens ?? 0)}</TableCell>
                  <TableCell sx={obsMonoSx}>{t.tool_call_count ?? 0}</TableCell>
                </TableRow>
              ))}
              {traces.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    <Typography sx={{ ...obsMonoSx, fontSize: '0.68rem', color: obs.text.dim, py: 2 }}>No traces for this session.</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      </ObsPanel>
      <Box>
        <Typography
          component={Link}
          to="/"
          sx={{ ...obsMonoSx, fontSize: '0.62rem', color: obs.accent.hud, display: 'inline-flex', alignItems: 'center', gap: 0.4, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
        >
          <ArrowBackIcon sx={{ fontSize: 13 }} /> Back to traces
        </Typography>
      </Box>
    </Box>
  );
}
