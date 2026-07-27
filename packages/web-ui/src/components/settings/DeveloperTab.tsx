/**
 * Settings → Developer tab (v1.1+ redesign).
 *
 * Layout:
 *   ┌─────────────────────────────────────────────┐
 *   │  TOP CARD: Developer Mode enable/disable     │
 *   ├──────────┬──────────────────────────────────┤
 *   │ SIDEBAR  │  CONTENT AREA                     │
 *   │ General  │  (General or Observability page)  │
 *   │ Observability │                             │
 *   │ Alerts   │                                   │
 *   │ Cost     │                                   │
 *   └──────────┴──────────────────────────────────┘
 *
 * When Developer Mode is OFF, the sidebar items are disabled and the content
 * area shows a locked placeholder.
 *
 * Styling follows the Agent-X military/spy/space command palette via
 * `settings-theme.ts` helpers — same as all other Settings tabs.
 */
import { useEffect, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Switch from '@mui/material/Switch';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';
import Slider from '@mui/material/Slider';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import InputAdornment from '@mui/material/InputAdornment';
import LockIcon from '@mui/icons-material/Lock';
import SettingsIcon from '@mui/icons-material/Settings';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import {
  getDevStatus, verifyDev, enableDev, disableDev, getConfig, updateConfig,
  purgeAll, getHealth,
  type HealthResponse,
} from '../../observability/api';
import { setDevMode as persistDevMode } from '../../utils/client-storage';
import type { ObservabilityConfig } from '@agentx/shared';
import { alphaColor } from '../../theme';
import {
  settingsTheme,
  settingsMonoSx,
  settingsHelperSx,
  settingsTextFieldSx,
  settingsBtnGhostSx,
  settingsBtnDangerSx,
  settingsBtnPrimarySx,
  settingsDialogPaperSx,
  settingsDialogTitleSx,
  settingsStatusBadgeSx,
  settingsCardSx,
  settingsScanlineSx,
} from '../../styles/settings-theme';
import { SettingsCard } from './SettingsCard';
import { SettingsSectionHeader } from './SettingsSectionHeader';

type DevSubPage = 'general' | 'observability';

const NAV_ITEMS: { id: DevSubPage; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'General', icon: <SettingsIcon sx={{ fontSize: 14 }} /> },
  { id: 'observability', label: 'Observability', icon: <MonitorHeartIcon sx={{ fontSize: 14 }} /> },
];

// Fixed retention intervals (in days). The slider operates on their indices
// so each interval has the same visual width, regardless of the numeric gap.
const RETENTION_DAYS = [1, 3, 5, 7, 14, 28, 35, 45, 60, 90, 120];
const RETENTION_MARKS = RETENTION_DAYS.map((_, i) => ({ value: i }));

/** Snap an arbitrary retention value to the nearest fixed interval. */
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

/** Retention slider with equal-width index steps and a hover-only day count label. */
function RetentionSlider({ value, onChange }: { value: number; onChange: (days: number) => void }) {
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
      size="small"
      onChange={(_, i) => setIndex(i as number)}
      onChangeCommitted={(_, i) => onChange(RETENTION_DAYS[i as number]!)}
      sx={{
        maxWidth: 360,
        color: settingsTheme.accent.hud,
        '& .MuiSlider-thumb': { color: settingsTheme.accent.hud },
        '& .MuiSlider-rail': { color: settingsTheme.border.default },
        '& .MuiSlider-mark': { backgroundColor: settingsTheme.border.strong },
        '& .MuiSlider-markLabel': { display: 'none' },
      }}
    />
  );
}

// Sidebar button sx — matches settingsTabSx but vertical sidebar layout.
function sidebarItemSx(active: boolean, disabled: boolean): object {
  return {
    ...settingsMonoSx,
    fontSize: '0.6rem',
    fontWeight: 700,
    letterSpacing: '1px',
    textTransform: 'uppercase',
    color: disabled
      ? settingsTheme.text.dim
      : active
        ? settingsTheme.accent.hud
        : settingsTheme.text.secondary,
    bgcolor: active ? settingsTheme.bg.hud : 'transparent',
    borderLeft: active
      ? `2px solid ${settingsTheme.accent.hud}`
      : '2px solid transparent',
    borderRadius: 0,
    py: 1,
    px: 1.5,
    '&:hover': {
      bgcolor: settingsTheme.bg.hud,
      color: disabled ? settingsTheme.text.dim : settingsTheme.text.primary,
    },
    '&.Mui-disabled': { opacity: 0.4 },
  };
}

export function DeveloperTab() {
  const [devMode, setDevMode] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [pwdError, setPwdError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [config, setConfig] = useState<ObservabilityConfig | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [subPage, setSubPage] = useState<DevSubPage>('general');

  const load = useCallback(async () => {
    try {
      const [status, cfg] = await Promise.all([getDevStatus(), getConfig().catch(() => null)]);
      setDevMode(status.enabled);
      persistDevMode(status.enabled);
      if (cfg) setConfig(cfg);
    } catch { /* dev mode not available yet */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!devMode) return;
    const t = setInterval(() => getHealth().then(setHealth).catch(() => {}), 10000);
    getHealth().then(setHealth).catch(() => {});
    return () => clearInterval(t);
  }, [devMode]);

  const handleToggleOn = () => {
    setPwdOpen(true);
    setPassword('');
    setPwdError('');
  };

  const handleVerify = async () => {
    setVerifying(true);
    setPwdError('');
    try {
      await verifyDev(password);
      await enableDev();
      setDevMode(true);
      persistDevMode(true);
      setPwdOpen(false);
      setMsg({ type: 'success', text: 'Developer mode enabled.' });
      load();
    } catch (e: unknown) {
      const err = e as { status?: number; message?: string };
      if (err.status === 429) setPwdError('Too many attempts. Try again in 5 minutes.');
      else if (err.status === 401) setPwdError('Incorrect password.');
      else setPwdError(err.message ?? 'Verification failed.');
    } finally {
      setVerifying(false);
    }
  };

  const handleToggleOff = async () => {
    try {
      await disableDev();
      setDevMode(false);
      persistDevMode(false);
      setMsg({ type: 'success', text: 'Developer mode disabled.' });
    } catch (e: unknown) {
      setMsg({ type: 'error', text: (e as Error).message });
    }
  };

  const saveConfig = async (patch: Partial<ObservabilityConfig>) => {
    try {
      const c = await updateConfig(patch);
      setConfig(c);
      setMsg({ type: 'success', text: 'Configuration updated.' });
    } catch (e: unknown) {
      setMsg({ type: 'error', text: (e as Error).message });
    }
  };

  const doPurge = async () => {
    setPurgeOpen(false);
    try {
      await purgeAll();
      setMsg({ type: 'success', text: 'All observability data purged.' });
    } catch (e: unknown) {
      setMsg({ type: 'error', text: (e as Error).message });
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <SettingsSectionHeader
        icon={<MonitorHeartIcon sx={{ fontSize: 16 }} />}
        title="Developer"
        subtitle="Observability, alerting & cost analytics"
      />

      {msg && (
        <Alert
          severity={msg.type}
          onClose={() => setMsg(null)}
          sx={{
            ...settingsMonoSx,
            fontSize: '0.6rem',
            mb: 1.25,
            bgcolor: msg.type === 'success' ? alphaColor(settingsTheme.accent.signal, '10') : alphaColor(settingsTheme.accent.alert, '10'),
            border: `1px solid ${msg.type === 'success' ? alphaColor(settingsTheme.accent.signal, '40') : alphaColor(settingsTheme.accent.alert, '40')}`,
          }}
        >
          {msg.text}
        </Alert>
      )}

      {/* ─── TOP CARD: Developer Mode toggle ─────────────────────────────── */}
      <SettingsCard
        title="Developer Mode"
        subtitle="Enables observability, alerting, cost analytics, and advanced configuration"
        accent={devMode ? settingsTheme.accent.signal : undefined}
        active={devMode}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Switch
            checked={devMode}
            onChange={(_, v) => v ? handleToggleOn() : handleToggleOff()}
            size="small"
            sx={{
              '& .MuiSwitch-switchBase.Mui-checked': { color: settingsTheme.accent.signal },
              '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                bgcolor: alphaColor(settingsTheme.accent.signal, '40'),
              },
            }}
          />
          {devMode ? (
            <Box sx={settingsStatusBadgeSx('active')}>Enabled</Box>
          ) : (
            <Box sx={settingsStatusBadgeSx('idle')}>Disabled</Box>
          )}
        </Box>
      </SettingsCard>

      {/* ─── SIDEBAR + CONTENT ───────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', gap: 1.5, minHeight: 360 }}>
        {/* Sidebar */}
        <Box
          sx={{
            width: 160,
            flexShrink: 0,
            bgcolor: settingsTheme.bg.inset,
            border: `1px solid ${settingsTheme.border.default}`,
            borderRadius: '6px',
            overflow: 'hidden',
          }}
        >
          <List dense disablePadding>
            {NAV_ITEMS.map((item) => (
              <ListItemButton
                key={item.id}
                selected={subPage === item.id}
                onClick={() => devMode && setSubPage(item.id)}
                disabled={!devMode}
                sx={sidebarItemSx(subPage === item.id, !devMode)}
              >
                <ListItemIcon sx={{ minWidth: 24, color: 'inherit' }}>{item.icon}</ListItemIcon>
                <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: '0.6rem', fontWeight: 700 }} />
              </ListItemButton>
            ))}
          </List>
        </Box>

        {/* Content area */}
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          {!devMode ? (
            <LockedPlaceholder />
          ) : subPage === 'general' ? (
            <GeneralPage health={health} />
          ) : subPage === 'observability' ? (
            <ObservabilityPage
              config={config}
              health={health}
              saveConfig={saveConfig}
              setPurgeOpen={setPurgeOpen}
            />
          ) : null}
        </Box>
      </Box>

      {/* Password dialog */}
      <Dialog
        open={pwdOpen}
        onClose={() => setPwdOpen(false)}
        PaperProps={{ sx: { ...settingsDialogPaperSx, maxWidth: 420 } }}
      >
        <DialogTitle sx={settingsDialogTitleSx}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LockIcon sx={{ fontSize: 14 }} />
            Verify Root Password
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ ...settingsHelperSx, mb: 2 }}>
            Enter the Agent-X root password to enable Developer Mode.
          </Typography>
          {pwdError && (
            <Alert
              severity="error"
              sx={{ ...settingsMonoSx, fontSize: '0.6rem', mb: 1.5, bgcolor: alphaColor(settingsTheme.accent.alert, '10') }}
            >
              {pwdError}
            </Alert>
          )}
          <TextField
            type="password"
            fullWidth
            autoFocus
            label="Root password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
            disabled={verifying}
            sx={settingsTextFieldSx}
          />
        </DialogContent>
        <DialogActions sx={{ p: 1.5 }}>
          <Button onClick={() => setPwdOpen(false)} sx={settingsBtnGhostSx}>Cancel</Button>
          <Button variant="contained" onClick={handleVerify} disabled={verifying || !password} sx={settingsBtnPrimarySx}>
            {verifying ? <CircularProgress size={14} sx={{ color: settingsTheme.bg.void }} /> : 'Verify'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Purge confirmation dialog */}
      <Dialog
        open={purgeOpen}
        onClose={() => setPurgeOpen(false)}
        PaperProps={{ sx: { ...settingsDialogPaperSx, maxWidth: 420 } }}
      >
        <DialogTitle sx={settingsDialogTitleSx}>Purge All Observability Data?</DialogTitle>
        <DialogContent>
          <Typography sx={{ ...settingsHelperSx, mb: 1 }}>
            This permanently deletes ALL traces, logs, and metrics.
          </Typography>
          <Typography sx={{ ...settingsHelperSx, color: settingsTheme.accent.alert }}>
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 1.5 }}>
          <Button onClick={() => setPurgeOpen(false)} sx={settingsBtnGhostSx}>Cancel</Button>
          <Button variant="contained" onClick={doPurge} sx={settingsBtnDangerSx}>Purge All</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ─── Locked placeholder ─────────────────────────────────────────────────────
function LockedPlaceholder() {
  return (
    <Box
      sx={{
        ...settingsCardSx(),
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 360,
        gap: 1,
      }}
    >
      <Box sx={settingsScanlineSx} />
      <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
        <LockIcon sx={{ fontSize: 36, color: settingsTheme.text.dim }} />
        <Typography sx={{ ...settingsMonoSx, fontSize: '0.6rem', color: settingsTheme.text.dim, textTransform: 'uppercase', letterSpacing: '1.5px' }}>
          Developer Mode Required
        </Typography>
        <Typography sx={{ ...settingsHelperSx, textAlign: 'center', maxWidth: 280 }}>
          Enable Developer Mode above to access observability, alerting, and cost analytics.
        </Typography>
      </Box>
    </Box>
  );
}

// ─── General page ───────────────────────────────────────────────────────────
function GeneralPage({ health }: { health: HealthResponse | null }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <SettingsCard title="System Health" subtitle="Exporter queue, drops, PG latency">
        {health ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0.75 }}>
            <StatItem
              label="Observability"
              value={health.enabled ? 'Enabled' : 'Disabled'}
              color={health.enabled ? settingsTheme.accent.signal : settingsTheme.text.dim}
            />
            <StatItem label="Queue Depth" value={String(health.exporterQueueDepth)} />
            <StatItem
              label="Dropped"
              value={String(health.exporterDroppedCount)}
              color={health.exporterDroppedCount > 0 ? settingsTheme.accent.alert : undefined}
            />
            <StatItem
              label="PG Latency"
              value={health.pgLatencyMs != null ? `${health.pgLatencyMs}ms` : '—'}
            />
          </Box>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
            <CircularProgress size={14} sx={{ color: settingsTheme.text.dim }} />
            <Typography sx={{ ...settingsHelperSx }}>Loading health…</Typography>
          </Box>
        )}
      </SettingsCard>

      <SettingsCard title="About" subtitle="Developer Mode scope">
        <Typography sx={{ ...settingsHelperSx, lineHeight: 1.6 }}>
          Developer Mode enables advanced observability features including distributed tracing,
          structured logs, metrics, alerting, and cost analytics. It is per-session and requires
          root password verification.
        </Typography>
      </SettingsCard>
    </Box>
  );
}

// ─── Observability page ─────────────────────────────────────────────────────
function ObservabilityPage({
  config, health, saveConfig, setPurgeOpen,
}: {
  config: ObservabilityConfig | null;
  health: HealthResponse | null;
  saveConfig: (patch: Partial<ObservabilityConfig>) => void;
  setPurgeOpen: (v: boolean) => void;
}) {
  const [otlpHeadersText, setOtlpHeadersText] = useState('');

  useEffect(() => {
    if (config?.otlp_headers) {
      setOtlpHeadersText(JSON.stringify(config.otlp_headers, null, 2));
    }
  }, [config?.otlp_headers]);

  if (!config) {
    return (
      <Box sx={{ ...settingsCardSx(), display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
        <CircularProgress size={14} sx={{ color: settingsTheme.text.dim }} />
        <Typography sx={{ ...settingsHelperSx }}>Loading config…</Typography>
      </Box>
    );
  }

  const saveOtlpHeaders = () => {
    try {
      const parsed = JSON.parse(otlpHeadersText || '{}');
      saveConfig({ otlp_headers: parsed });
    } catch {
      /* invalid JSON — ignore */
    }
  };

  // Themed accordion sx. Override MUI's default expanded margins so the
  // spacing between cards does not grow when an accordion is expanded.
  const accordionSx = {
    bgcolor: 'transparent',
    border: `1px solid ${settingsTheme.border.default}`,
    borderRadius: '6px',
    mb: 1.25,
    overflow: 'hidden',
    '&:before': { display: 'none' },
    '&.Mui-expanded': {
      mt: 0,
      mb: 1.25,
    },
    '&.Mui-disabled': {
      backgroundColor: 'transparent',
    },
    '& .MuiAccordionSummary-root': {
      ...settingsMonoSx,
      fontSize: '0.62rem',
      fontWeight: 700,
      letterSpacing: '1px',
      textTransform: 'uppercase',
      color: settingsTheme.text.secondary,
      bgcolor: settingsTheme.bg.panel,
      minHeight: 36,
      '&.Mui-expanded': { minHeight: 36 },
      '&:hover': { bgcolor: settingsTheme.bg.hud },
    },
    '& .MuiAccordionDetails-root': {
      bgcolor: settingsTheme.bg.inset,
      padding: 1.75,
    },
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Open observability */}
      <SettingsCard title="Dashboard" subtitle="Open the observability web UI">
        <Button
          variant="outlined"
          size="small"
          onClick={() => window.open(`${window.location.origin}/observability`, '_blank', 'noopener')}
          sx={settingsBtnGhostSx}
        >
          Open Observability
        </Button>
      </SettingsCard>

      {/* Core config */}
      <SettingsCard title="Core Settings" subtitle="Enable, capture, retention">
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.62rem', color: settingsTheme.text.secondary }}>
              Observability Enabled
            </Typography>
            <Switch
              checked={config.enabled}
              onChange={(_, v) => saveConfig({ enabled: v })}
              size="small"
              sx={{
                '& .MuiSwitch-switchBase.Mui-checked': { color: settingsTheme.accent.signal },
                '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: alphaColor(settingsTheme.accent.signal, '40') },
              }}
            />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.62rem', color: settingsTheme.text.secondary }}>
              Capture Prompts &amp; Responses
            </Typography>
            <Switch
              checked={config.capture_prompts}
              onChange={(_, v) => saveConfig({ capture_prompts: v })}
              size="small"
              sx={{
                '& .MuiSwitch-switchBase.Mui-checked': { color: settingsTheme.accent.signal },
                '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: alphaColor(settingsTheme.accent.signal, '40') },
              }}
            />
          </Box>
          <Box>
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.62rem', color: settingsTheme.text.secondary, mb: 0.5 }}>
              Retention: {config.retention_days} days
            </Typography>
            <RetentionSlider value={config.retention_days} onChange={(days) => saveConfig({ retention_days: days })} />
          </Box>
        </Box>
      </SettingsCard>

      {/* OTLP external collector */}
      <Accordion sx={accordionSx}>
        <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ fontSize: 16, color: settingsTheme.text.dim }} />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CloudUploadIcon sx={{ fontSize: 14, color: config.otlp_enabled ? settingsTheme.accent.hud : settingsTheme.text.dim }} />
            External Collector (OTLP)
            {config.otlp_enabled && (
              <Box sx={settingsStatusBadgeSx('active')}>Active</Box>
            )}
          </Box>
        </AccordionSummary>
        <AccordionDetails sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <Typography sx={{ ...settingsHelperSx, mb: 0.5 }}>
            Export spans to an external OTLP receiver (SigNoz, Langfuse, Jaeger, etc.) in addition to the local Postgres store.
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.62rem', color: settingsTheme.text.secondary }}>
              Enable OTLP Export
            </Typography>
            <Switch
              checked={config.otlp_enabled ?? false}
              onChange={(_, v) => saveConfig({ otlp_enabled: v })}
              size="small"
              disabled={!config.otlp_enabled && !config.enabled}
              sx={{
                '& .MuiSwitch-switchBase.Mui-checked': { color: settingsTheme.accent.signal },
                '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: alphaColor(settingsTheme.accent.signal, '40') },
              }}
            />
          </Box>
          <TextField
            size="small"
            fullWidth
            label="OTLP Endpoint"
            value={config.otlp_endpoint ?? ''}
            onChange={(e) => saveConfig({ otlp_endpoint: e.target.value })}
            placeholder="http://localhost:4318/v1/traces"
            disabled={!config.otlp_enabled}
            sx={settingsTextFieldSx}
          />
          <TextField
            select
            size="small"
            fullWidth
            label="Protocol"
            value={config.otlp_protocol ?? 'http'}
            onChange={(e) => saveConfig({ otlp_protocol: e.target.value as 'http' | 'grpc' })}
            disabled={!config.otlp_enabled}
            sx={settingsTextFieldSx}
          >
            <MenuItem value="http">HTTP / Protobuf</MenuItem>
            <MenuItem value="grpc">gRPC</MenuItem>
          </TextField>
          <TextField
            size="small"
            fullWidth
            multiline
            rows={3}
            label="Headers (JSON)"
            value={otlpHeadersText}
            onChange={(e) => setOtlpHeadersText(e.target.value)}
            onBlur={saveOtlpHeaders}
            placeholder='{"Authorization": "Bearer ..."}'
            disabled={!config.otlp_enabled}
            sx={{ ...settingsTextFieldSx, '& .MuiInputBase-input': { fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem' } }}
          />
        </AccordionDetails>
      </Accordion>

      {/* Alerting config */}
      <Accordion sx={accordionSx}>
        <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ fontSize: 16, color: settingsTheme.text.dim }} />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <WarningAmberIcon sx={{ fontSize: 14, color: config.alerting_enabled ? settingsTheme.accent.amber : settingsTheme.text.dim }} />
            Alerting (SLO Breaches)
            {config.alerting_enabled && (
              <Box sx={settingsStatusBadgeSx('warn')}>Active</Box>
            )}
          </Box>
        </AccordionSummary>
        <AccordionDetails sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <Typography sx={{ ...settingsHelperSx, mb: 0.5 }}>
            Automatically detect error-rate and latency SLO breaches and record alerts.
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.62rem', color: settingsTheme.text.secondary }}>
              Enable Alerting
            </Typography>
            <Switch
              checked={config.alerting_enabled ?? false}
              onChange={(_, v) => saveConfig({ alerting_enabled: v })}
              size="small"
              sx={{
                '& .MuiSwitch-switchBase.Mui-checked': { color: settingsTheme.accent.signal },
                '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: alphaColor(settingsTheme.accent.signal, '40') },
              }}
            />
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            <TextField
              size="small"
              type="number"
              label="Error Rate Threshold"
              value={config.alerting_error_rate_pct ?? 10}
              onChange={(e) => saveConfig({ alerting_error_rate_pct: Number(e.target.value) })}
              disabled={!config.alerting_enabled}
              sx={{ ...settingsTextFieldSx, width: 170 }}
              InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
            />
            <TextField
              size="small"
              type="number"
              label="Latency p95 Threshold"
              value={config.alerting_latency_p95_ms ?? 30000}
              onChange={(e) => saveConfig({ alerting_latency_p95_ms: Number(e.target.value) })}
              disabled={!config.alerting_enabled}
              sx={{ ...settingsTextFieldSx, width: 200 }}
              InputProps={{ endAdornment: <InputAdornment position="end">ms</InputAdornment> }}
            />
            <TextField
              size="small"
              type="number"
              label="Window"
              value={config.alerting_window_minutes ?? 15}
              onChange={(e) => saveConfig({ alerting_window_minutes: Number(e.target.value) })}
              disabled={!config.alerting_enabled}
              sx={{ ...settingsTextFieldSx, width: 140 }}
              InputProps={{ endAdornment: <InputAdornment position="end">min</InputAdornment> }}
            />
          </Box>
        </AccordionDetails>
      </Accordion>

      {/* Health readout */}
      {health && (
        <SettingsCard title="Exporter Health" subtitle="Live queue + drop metrics">
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.75 }}>
            <StatItem label="Queue" value={String(health.exporterQueueDepth)} />
            <StatItem
              label="Dropped"
              value={String(health.exporterDroppedCount)}
              color={health.exporterDroppedCount > 0 ? settingsTheme.accent.alert : undefined}
            />
            <StatItem
              label="PG Latency"
              value={health.pgLatencyMs != null ? `${health.pgLatencyMs}ms` : '—'}
            />
          </Box>
        </SettingsCard>
      )}

      {/* Danger zone */}
      <SettingsCard title="Danger Zone" subtitle="Irreversible operations" accent={settingsTheme.accent.alert}>
        <Button variant="outlined" size="small" onClick={() => setPurgeOpen(true)} sx={settingsBtnDangerSx}>
          Purge All Observability Data
        </Button>
      </SettingsCard>
    </Box>
  );
}

// ─── Shared StatItem helper (matches PersistenceTab style) ──────────────────
function StatItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box sx={{ p: 1, borderRadius: '4px', bgcolor: settingsTheme.bg.hud, border: `1px solid ${settingsTheme.border.subtle}` }}>
      <Typography sx={{ fontSize: '0.5rem', color: settingsTheme.text.dim, mb: 0.35, ...settingsMonoSx, textTransform: 'uppercase', letterSpacing: '0.8px' }}>{label}</Typography>
      <Typography sx={{ fontSize: '0.68rem', color: color || settingsTheme.text.primary, fontWeight: 700, ...settingsMonoSx }}>{value}</Typography>
    </Box>
  );
}
