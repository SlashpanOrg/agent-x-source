/**
 * Cost analytics page (v1.1+) — per-provider, per-model, per-day cost rollups.
 *
 * Shows a table + summary cards of cost data from the `observability.cost_rollup_daily`
 * materialized view. Refreshed on load.
 */
import { useEffect, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import PaidIcon from '@mui/icons-material/Paid';
import { getCostRollup } from '../api';
import { useObs } from '../context';
import type { CostRollupRow } from '@agentx/shared';
import { ObsPanel, ObsPageHeader } from '../components/ObsPanel';
import { obs, obsMonoSx, obsInputSx } from '../obs-theme';

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Box sx={{ flex: '1 1 140px', minWidth: 140, p: 1.25, borderRadius: '6px', bgcolor: obs.bg.hud, border: `1px solid ${obs.border.subtle}` }}>
      <Typography sx={{ ...obsMonoSx, fontSize: '0.56rem', color: obs.text.dim, textTransform: 'uppercase', letterSpacing: '1px' }}>{label}</Typography>
      <Typography sx={{ ...obsMonoSx, fontSize: '1.1rem', color: accent ?? obs.text.primary, fontWeight: 700, mt: 0.25 }}>{value}</Typography>
    </Box>
  );
}

export function CostAnalyticsPage() {
  const { refreshTick } = useObs();
  const [rows, setRows] = useState<CostRollupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [days, setDays] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getCostRollup(days);
      setRows(res.rows);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load, refreshTick]);

  const totals = rows.reduce(
    (acc, r) => ({
      cost: acc.cost + Number(r.total_cost_usd ?? 0),
      input: acc.input + Number(r.total_input_tokens ?? 0),
      output: acc.output + Number(r.total_output_tokens ?? 0),
      traces: acc.traces + Number(r.trace_count ?? 0),
    }),
    { cost: 0, input: 0, output: 0, traces: 0 },
  );

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress size={24} sx={{ color: obs.accent.hud }} /></Box>;
  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <ObsPageHeader
        icon={<PaidIcon sx={{ fontSize: 18 }} />}
        title="Cost Analytics"
        action={
          <TextField
            select size="small" label="Window" value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            sx={{ width: 110, ...obsInputSx }}
          >
            {[7, 14, 30, 60, 90, 365].map((d) => <MenuItem key={d} value={d}>{d}d</MenuItem>)}
          </TextField>
        }
      />

      {/* Summary cards */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <StatCard label="Total Cost" value={`$${totals.cost.toFixed(4)}`} accent={obs.accent.signal} />
        <StatCard label="Input Tokens" value={totals.input.toLocaleString()} />
        <StatCard label="Output Tokens" value={totals.output.toLocaleString()} />
        <StatCard label="Traces" value={totals.traces.toLocaleString()} />
      </Box>

      {/* Cost table */}
      <ObsPanel noBodyPadding>
        <Box className="ax-scroll" sx={{ maxHeight: 560 }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell>Day</TableCell>
                <TableCell>Provider</TableCell>
                <TableCell>Model</TableCell>
                <TableCell>Domain</TableCell>
                <TableCell align="right">Traces</TableCell>
                <TableCell align="right">Input Tokens</TableCell>
                <TableCell align="right">Output Tokens</TableCell>
                <TableCell align="right">Cost (USD)</TableCell>
                <TableCell align="right">Avg Duration</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i} hover>
                  <TableCell sx={obsMonoSx}>{r.day}</TableCell>
                  <TableCell sx={obsMonoSx}>{r.provider}</TableCell>
                  <TableCell sx={{ ...obsMonoSx, fontSize: '0.62rem' }}>{r.model}</TableCell>
                  <TableCell sx={obsMonoSx}>{r.domain}</TableCell>
                  <TableCell align="right" sx={obsMonoSx}>{r.trace_count?.toLocaleString()}</TableCell>
                  <TableCell align="right" sx={obsMonoSx}>{r.total_input_tokens?.toLocaleString()}</TableCell>
                  <TableCell align="right" sx={obsMonoSx}>{r.total_output_tokens?.toLocaleString()}</TableCell>
                  <TableCell align="right" sx={{ ...obsMonoSx, color: obs.accent.signal, fontWeight: 700 }}>${Number(r.total_cost_usd ?? 0).toFixed(4)}</TableCell>
                  <TableCell align="right" sx={obsMonoSx}>{r.avg_duration_ms != null ? `${Math.round(r.avg_duration_ms)}ms` : '—'}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} align="center">
                    <Typography sx={{ ...obsMonoSx, fontSize: '0.68rem', color: obs.text.dim, py: 2 }}>No cost data in the selected period.</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      </ObsPanel>
    </Box>
  );
}
