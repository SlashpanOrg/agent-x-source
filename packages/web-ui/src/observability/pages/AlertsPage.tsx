/**
 * Alerts page (v1.1+) — lists SLO breach alerts (error-rate, latency-p95).
 *
 * Shows active alerts with severity, message, threshold vs actual, and
 * allows resolving them. Also shows recently resolved alerts.
 */
import { useEffect, useState, useCallback } from 'react';
import {
  Box, Typography, Paper, CircularProgress, Alert as MuiAlert, Button,
  Chip, List, ListItem, ListItemText, ListItemSecondaryAction, Divider,
  ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import { listAlerts, resolveAlert } from '../api';
import { useObs } from '../context';
import type { AlertRow } from '@agentx/shared';

export function AlertsPage() {
  const { refreshTick } = useObs();
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showResolved, setShowResolved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAlerts(showResolved);
      setAlerts(res.alerts);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [showResolved]);

  useEffect(() => { load(); }, [load, refreshTick]);

  const handleResolve = async (id: number) => {
    try {
      await resolveAlert(id);
      load();
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center' }}><CircularProgress /></Box>;
  if (error) return <MuiAlert severity="error">{error}</MuiAlert>;

  const severityColor = (s: string) => s === 'critical' ? 'error' : s === 'warning' ? 'warning' : 'info';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Typography variant="h6">Alerts</Typography>
        <Box sx={{ flexGrow: 1 }} />
        <ToggleButtonGroup size="small" value={showResolved ? 'resolved' : 'active'} exclusive onChange={(_, v) => v && setShowResolved(v === 'resolved')}>
          <ToggleButton value="active">Active</ToggleButton>
          <ToggleButton value="resolved">Resolved</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {alerts.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            {showResolved ? 'No resolved alerts.' : 'No active alerts. All SLOs are within thresholds.'}
          </Typography>
        </Paper>
      ) : (
        <Paper>
          <List>
            {alerts.map((a, i) => (
              <Box key={a.id}>
                {i > 0 && <Divider />}
                <ListItem>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Chip size="small" color={severityColor(a.severity) as 'error' | 'warning' | 'info'} label={a.severity} />
                        <Chip size="small" variant="outlined" label={a.type === 'error_rate' ? 'Error Rate' : 'Latency p95'} />
                        <Typography variant="body2">{a.message}</Typography>
                      </Box>
                    }
                    secondary={
                      <Typography variant="caption" color="text.secondary">
                        {new Date(a.triggered_at).toLocaleString()} · Threshold: {a.threshold}{a.type === 'error_rate' ? '%' : 'ms'} · Actual: {a.actual}{a.type === 'error_rate' ? '%' : 'ms'} · Window: {a.window_minutes}min
                        {a.resolved && a.resolved_at && ` · Resolved: ${new Date(a.resolved_at).toLocaleString()}`}
                      </Typography>
                    }
                  />
                  {!a.resolved && (
                    <ListItemSecondaryAction>
                      <Button size="small" onClick={() => handleResolve(a.id)}>Resolve</Button>
                    </ListItemSecondaryAction>
                  )}
                </ListItem>
              </Box>
            ))}
          </List>
        </Paper>
      )}
    </Box>
  );
}
