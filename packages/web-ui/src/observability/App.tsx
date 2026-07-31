/** Observability app shell — icon-rail nav + HUD top bar + routed pages (§11.2). */
import { useEffect, useState, Suspense, lazy } from 'react';
import { Routes, Route, NavLink, useLocation, Navigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { useColorScheme } from '@mui/material/styles';
import TimelineIcon from '@mui/icons-material/Timeline';
import SubjectIcon from '@mui/icons-material/Subject';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import SettingsIcon from '@mui/icons-material/Settings';
import PaidIcon from '@mui/icons-material/Paid';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import CloseIcon from '@mui/icons-material/Close';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import ContrastIcon from '@mui/icons-material/Contrast';
import { useObs } from './context';
import { TimeRangeSelector } from './components/TimeRangeSelector';
import { RefreshControl } from './components/RefreshControl';
import { DomainToggle } from './components/DomainToggle';
import { getDevStatus } from './api';
import { obs, obsOverlineSx, obsBadgeSx, NAV_WIDTH, TOPBAR_HEIGHT } from './obs-theme';
import { alphaColor } from '../theme';

// Lazy-load pages to keep the initial bundle small.
const TraceListPage = lazy(() => import('./pages/TraceListPage').then((m) => ({ default: m.TraceListPage })));
const TraceDetailPage = lazy(() => import('./pages/TraceDetailPage').then((m) => ({ default: m.TraceDetailPage })));
const LogsPage = lazy(() => import('./pages/LogsPage').then((m) => ({ default: m.LogsPage })));
const MetricsDashboard = lazy(() => import('./pages/MetricsDashboard').then((m) => ({ default: m.MetricsDashboard })));
const ConfigPage = lazy(() => import('./pages/ConfigPage').then((m) => ({ default: m.ConfigPage })));
const VerifyScreen = lazy(() => import('./pages/VerifyScreen').then((m) => ({ default: m.VerifyScreen })));
const SessionTracesPage = lazy(() => import('./pages/SessionTracesPage').then((m) => ({ default: m.SessionTracesPage })));
const CostAnalyticsPage = lazy(() => import('./pages/CostAnalyticsPage').then((m) => ({ default: m.CostAnalyticsPage })));

const NAV_ITEMS = [
  { to: '/', label: 'Traces', icon: <TimelineIcon sx={{ fontSize: 18 }} /> },
  { to: '/logs', label: 'Logs', icon: <SubjectIcon sx={{ fontSize: 18 }} /> },
  { to: '/metrics', label: 'Metrics', icon: <ShowChartIcon sx={{ fontSize: 18 }} /> },
  { to: '/cost', label: 'Cost', icon: <PaidIcon sx={{ fontSize: 18 }} /> },
  { to: '/config', label: 'Config', icon: <SettingsIcon sx={{ fontSize: 18 }} /> },
];

const MODE_CYCLE = ['dark', 'light', 'system'] as const;

function LoadingFallback() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
      <CircularProgress size={28} sx={{ color: obs.accent.hud }} />
    </Box>
  );
}

function NavRail() {
  const location = useLocation();
  return (
    <Box
      sx={{
        width: NAV_WIDTH, minWidth: NAV_WIDTH, height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', py: 1, borderRight: `1px solid ${obs.border.default}`,
        bgcolor: obs.bg.panel,
      }}
    >
      <Tooltip title="Agent-X Observability" placement="right">
        <Box sx={{ mb: 1.5, cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32 }}>
          <img src="/logo.png" alt="Agent-X" style={{ width: 20, height: 20, objectFit: 'contain' }} />
        </Box>
      </Tooltip>
      <Box sx={{ width: 24, height: '1px', bgcolor: obs.border.default, mb: 1 }} />
      {NAV_ITEMS.map((item) => {
        const active = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to);
        return (
          <Tooltip key={item.to} title={item.label} placement="right">
            <IconButton
              component={NavLink}
              to={item.to}
              sx={{
                mb: 0.25, width: 32, height: 32, borderRadius: 1,
                color: active ? obs.accent.hud : obs.text.dim,
                bgcolor: active ? alphaColor(obs.accent.hud, 0.12) : 'transparent',
                '&:hover': { bgcolor: alphaColor(obs.accent.hud, 0.08), color: obs.accent.hud },
              }}
            >
              {item.icon}
            </IconButton>
          </Tooltip>
        );
      })}
      <Box sx={{ flexGrow: 1 }} />
      <ThemeToggle />
      <Tooltip title="Close observability window" placement="right">
        <IconButton
          onClick={() => { try { window.close(); } catch { /* not a popup */ } }}
          sx={{ width: 32, height: 32, borderRadius: 1, color: obs.text.dim, '&:hover': { bgcolor: alphaColor(obs.accent.alert, 0.1), color: obs.accent.alert } }}
        >
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

function ThemeToggle() {
  const { mode, setMode } = useColorScheme();
  const currentMode = mode ?? 'dark';
  const cycle = () => {
    const next = MODE_CYCLE[(MODE_CYCLE.indexOf(currentMode as typeof MODE_CYCLE[number]) + 1) % MODE_CYCLE.length]!;
    setMode(next);
  };
  const icon = currentMode === 'light'
    ? <LightModeOutlinedIcon sx={{ fontSize: 16 }} />
    : currentMode === 'system'
      ? <ContrastIcon sx={{ fontSize: 16 }} />
      : <DarkModeOutlinedIcon sx={{ fontSize: 16 }} />;
  return (
    <Tooltip title={`Theme: ${currentMode}`} placement="right">
      <IconButton
        onClick={cycle}
        sx={{ mb: 0.5, width: 32, height: 32, borderRadius: 1, color: obs.text.dim, '&:hover': { bgcolor: alphaColor(obs.accent.hud, 0.08), color: obs.accent.hud } }}
      >
        {icon}
      </IconButton>
    </Tooltip>
  );
}

export function App() {
  const { domain, setDomain, timeRange, setTimeRange, refreshInterval, setRefreshInterval, triggerRefresh, devMode, setDevModeState } = useObs();
  const [devChecked, setDevChecked] = useState(false);

  // Check dev-mode status on load.
  useEffect(() => {
    let cancelled = false;
    getDevStatus()
      .then((s) => {
        if (cancelled) return;
        setDevChecked(true);
        setDevModeState(s.enabled);
      })
      .catch(() => { if (!cancelled) setDevChecked(true); });
    return () => { cancelled = true; };
  }, [setDevModeState]);

  // Don't render routes until dev status is checked.
  if (!devChecked) return <LoadingFallback />;

  // Data pages are accessible without dev mode. Only the Config page requires
  // dev mode — if dev mode is off and user navigates to /config, show the
  // verify screen there instead.

  return (
    <Box sx={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', bgcolor: obs.bg.void }}>
      <NavRail />

      {/* Main content */}
      <Box sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top bar */}
        <Box
          sx={{
            height: TOPBAR_HEIGHT, minHeight: TOPBAR_HEIGHT, flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 1.25, px: 1.75,
            borderBottom: `1px solid ${obs.border.default}`,
            bgcolor: obs.bg.panel,
            overflowX: 'auto',
          }}
        >
          <Typography sx={{ ...obsOverlineSx, fontSize: '0.68rem', color: obs.accent.hud, flexShrink: 0, letterSpacing: '2.5px' }}>
            OBSERVABILITY
          </Typography>
          <Box sx={{ width: '1px', height: 18, bgcolor: obs.border.default, flexShrink: 0 }} />
          <DomainToggle value={domain} onChange={setDomain} />
          <Box sx={{ flexGrow: 1, minWidth: 12 }} />
          <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
          <RefreshControl interval={refreshInterval} onIntervalChange={setRefreshInterval} onRefreshNow={triggerRefresh} />
          <Box
            sx={obsBadgeSx(devMode ? 'ok' : 'idle')}
            title={devMode ? 'Developer Mode is enabled for this session' : 'Developer Mode is locked — required for Config'}
          >
            {devMode ? <LockOpenIcon sx={{ fontSize: 11 }} /> : <LockIcon sx={{ fontSize: 11 }} />}
            {devMode ? 'Dev Mode' : 'Locked'}
          </Box>
        </Box>

        {/* Page content */}
        <Box className="ax-scroll" sx={{ flexGrow: 1, p: 2, minHeight: 0 }}>
          <Suspense fallback={<LoadingFallback />}>
            <Routes>
              <Route path="/" element={<TraceListPage />} />
              <Route path="/trace/:traceId" element={<TraceDetailPage />} />
              <Route path="/session/:sessionId" element={<SessionTracesPage />} />
              <Route path="/logs" element={<LogsPage />} />
              <Route path="/metrics" element={<MetricsDashboard />} />
              <Route path="/cost" element={<CostAnalyticsPage />} />
              {/* Config page requires dev mode — show verify screen if locked */}
              <Route path="/config" element={devMode ? <ConfigPage /> : <Suspense fallback={<LoadingFallback />}><VerifyScreen /></Suspense>} />
              <Route path="/verify" element={<Suspense fallback={<LoadingFallback />}><VerifyScreen /></Suspense>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </Box>
      </Box>
    </Box>
  );
}
