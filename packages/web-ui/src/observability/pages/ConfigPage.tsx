/** Config page (§11.8) — retention, capture_prompts, enabled, purge, health. */
import { useEffect, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Switch from '@mui/material/Switch';
import Slider from '@mui/material/Slider';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import StorageIcon from '@mui/icons-material/Storage';
import TuneIcon from '@mui/icons-material/Tune';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { getConfig, updateConfig, purgeAll, getHealth, type HealthResponse } from '../api';
import type { ObservabilityConfig } from '@agentx/shared';
import { obs, obsMonoSx, obsOverlineSx, obsBtnDangerSx } from '../obs-theme';
import { ObsPanel } from '../components/ObsPanel';
import { alphaColor } from '../../theme';

// Fixed retention intervals (in days). The slider operates on their indices
// so each interval has the same visual width, regardless of the numeric gap.
const RETENTION_DAYS = [1, 3, 5, 7, 14, 28, 35, 45, 60, 90, 120];
const RETENTION_MARKS = RETENTION_DAYS.map((_, i) => ({ value: i }));

/** Snap an arbitrary retention value to the nearest fixed interval index. */
function snapRetention(days: number): number {
  if (RETENTION_DAYS.includes(days)) return RETENTION_DAYS.indexOf(days);
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < RETENTION_DAYS.length; i++) {
    const dist = Math.abs(RETENTION_DAYS[i]! - days);
    if (dist < bestDist) { bestDist = dist; best = i; }
  }
  return best;
}

function SwitchRow({ label, help, checked, onChange, disabled }: {
  label: string; help: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, py: 1 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ ...obsMonoSx, fontSize: '0.68rem', color: obs.text.primary, fontWeight: 600 }}>{label}</Typography>
        <Typography sx={{ ...obsMonoSx, fontSize: '0.6rem', color: obs.text.dim, mt: 0.2 }}>{help}</Typography>
      </Box>
      <Switch
        checked={checked}
        onChange={(_, v) => onChange(v)}
        disabled={disabled}
        size="small"
        sx={{
          '& .MuiSwitch-switchBase.Mui-checked': { color: obs.accent.signal },
          '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: alphaColor(obs.accent.signal, 0.4) },
        }}
      />
    </Box>
  );
}

export function ConfigPage() {
  const [config, setConfig] = useState<ObservabilityConfig | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, h] = await Promise.all([getConfig(), getHealth()]);
      setConfig(c);
      setHealth(h);
    } catch (e: unknown) {
      setMsg({ type: 'error', text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => getHealth().then(setHealth).catch(() => {}), 10000);
    return () => clearInterval(t);
  }, []);

  const save = async (patch: Partial<ObservabilityConfig>) => {
    setSaving(true);
    try {
      const c = await updateConfig(patch);
      setConfig(c);
      setMsg({ type: 'success', text: 'Configuration updated.' });
    } catch (e: unknown) {
      setMsg({ type: 'error', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const doPurge = async () => {
    setPurgeOpen(false);
    try {
      await purgeAll();
      setMsg({ type: 'success', text: 'All observability data purged.' });
      load();
    } catch (e: unknown) {
      setMsg({ type: 'error', text: (e as Error).message });
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress size={24} sx={{ color: obs.accent.hud }} />
      </Box>
    );
  }
  if (!config) return <Alert severity="error">Failed to load config.</Alert>;

  return (
    <Box sx={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {msg && (
        <Alert
          severity={msg.type}
          onClose={() => setMsg(null)}
          sx={{
            ...obsMonoSx, fontSize: '0.62rem',
            bgcolor: msg.type === 'success' ? alphaColor(obs.accent.signal, 0.1) : alphaColor(obs.accent.alert, 0.1),
            border: `1px solid ${msg.type === 'success' ? alphaColor(obs.accent.signal, 0.35) : alphaColor(obs.accent.alert, 0.35)}`,
          }}
        >
          {msg.text}
        </Alert>
      )}

      {/* Retention */}
      <ObsPanel icon={<StorageIcon sx={{ fontSize: 16 }} />} title="Retention" subtitle="Traces &amp; metrics older than this are purged automatically">
        <Typography sx={{ ...obsMonoSx, fontSize: '0.7rem', color: obs.text.primary, fontWeight: 700, mb: 1 }}>
          {config.retention_days} days
        </Typography>
        <Box sx={{ px: 1 }}>
          <RetentionSlider value={config.retention_days} onChange={(days) => save({ retention_days: days })} disabled={saving} />
        </Box>
      </ObsPanel>

      {/* Capture settings */}
      <ObsPanel icon={<TuneIcon sx={{ fontSize: 16 }} />} title="Capture Settings" subtitle="Control what gets recorded">
        <SwitchRow
          label="Capture Prompts &amp; Responses"
          help="Disabling redacts prompt/response detail; token counts and structure are kept."
          checked={config.capture_prompts}
          onChange={(v) => save({ capture_prompts: v })}
          disabled={saving}
        />
        <Box sx={{ height: '1px', bgcolor: obs.border.subtle, my: 0.5 }} />
        <SwitchRow
          label="Observability Enabled"
          help="Pausing stops new collection; existing data is retained."
          checked={config.enabled}
          onChange={(v) => save({ enabled: v })}
          disabled={saving}
        />
      </ObsPanel>

      {/* Health */}
      <ObsPanel icon={<MonitorHeartIcon sx={{ fontSize: 16 }} />} title="Exporter Health" subtitle="Live queue + drop metrics">
        {health ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0.75 }}>
            <HealthStat label="Queue Depth" value={health.exporterQueueDepth} />
            <HealthStat label="Dropped" value={health.exporterDroppedCount} color={health.exporterDroppedCount > 0 ? obs.accent.alert : undefined} />
            <HealthStat label="Last Flush" value={health.lastFlushAt ? new Date(health.lastFlushAt).toLocaleTimeString() : '—'} />
            <HealthStat label="PG Latency" value={health.pgLatencyMs != null ? `${health.pgLatencyMs}ms` : '—'} />
          </Box>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={12} sx={{ color: obs.text.dim }} />
            <Typography sx={{ ...obsMonoSx, fontSize: '0.62rem', color: obs.text.dim }}>Loading health…</Typography>
          </Box>
        )}
      </ObsPanel>

      {/* Purge */}
      <ObsPanel icon={<WarningAmberIcon sx={{ fontSize: 16 }} />} title="Danger Zone" subtitle="Irreversible operations" accent={obs.accent.alert}>
        <Typography sx={{ ...obsMonoSx, fontSize: '0.62rem', color: obs.text.dim, mb: 1.25, lineHeight: 1.6 }}>
          Permanently delete all traces, spans, logs, and metric samples.
        </Typography>
        <Button onClick={() => setPurgeOpen(true)} sx={obsBtnDangerSx}>
          Purge All Observability Data
        </Button>
      </ObsPanel>

      <Dialog
        open={purgeOpen}
        onClose={() => setPurgeOpen(false)}
        PaperProps={{ sx: { bgcolor: obs.bg.void, border: `1px solid ${obs.border.default}`, maxWidth: 420 } }}
      >
        <DialogTitle sx={{ ...obsOverlineSx, fontSize: '0.72rem', color: obs.accent.alert, borderBottom: `1px solid ${obs.border.subtle}` }}>
          Purge All Observability Data?
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Typography sx={{ ...obsMonoSx, fontSize: '0.68rem', color: obs.text.secondary, mb: 1 }}>
            This permanently deletes ALL traces, logs, and metrics.
          </Typography>
          <Typography sx={{ ...obsMonoSx, fontSize: '0.68rem', color: obs.accent.alert }}>
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 1.5 }}>
          <Button onClick={() => setPurgeOpen(false)} sx={{ ...obsMonoSx, fontSize: '0.62rem', textTransform: 'uppercase', color: obs.text.dim }}>Cancel</Button>
          <Button onClick={doPurge} sx={obsBtnDangerSx}>Purge All</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function HealthStat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <Box sx={{ p: 1, borderRadius: '4px', bgcolor: obs.bg.hud, border: `1px solid ${obs.border.subtle}` }}>
      <Typography sx={{ ...obsMonoSx, fontSize: '0.5rem', color: obs.text.dim, mb: 0.35, textTransform: 'uppercase', letterSpacing: '0.8px' }}>{label}</Typography>
      <Typography sx={{ ...obsMonoSx, fontSize: '0.7rem', color: color ?? obs.text.primary, fontWeight: 700 }}>{value}</Typography>
    </Box>
  );
}

/** Retention slider with equal-width index steps and a hover-only day count label. */
function RetentionSlider({ value, onChange, disabled }: { value: number; onChange: (days: number) => void; disabled?: boolean }) {
  const [index, setIndex] = useState(() => snapRetention(value));

  useEffect(() => {
    setIndex(snapRetention(value));
  }, [value]);

  return (
    <Slider
      value={index}
      min={0}
      max={RETENTION_DAYS.length - 1}
      step={1}
      marks={RETENTION_MARKS}
      valueLabelDisplay="auto"
      valueLabelFormat={(i) => `${RETENTION_DAYS[i as number]}d`}
      disabled={disabled}
      onChange={(_, i) => setIndex(i as number)}
      onChangeCommitted={(_, i) => onChange(RETENTION_DAYS[i as number]!)}
      sx={{
        color: obs.accent.hud,
        '& .MuiSlider-thumb': { color: obs.accent.hud },
        '& .MuiSlider-rail': { color: obs.border.default },
        '& .MuiSlider-mark': { backgroundColor: obs.border.strong },
        '& .MuiSlider-markLabel': { display: 'none' },
      }}
    />
  );
}
