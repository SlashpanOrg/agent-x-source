import { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Switch from '@mui/material/Switch';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import useMediaQuery from '@mui/material/useMediaQuery';
import PublicIcon from '@mui/icons-material/Public';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import DownloadIcon from '@mui/icons-material/Download';
import type { HostConfig } from '@agentx/shared/browser';
import { defaultHostConfig, mergeHostConfig } from '@agentx/shared/browser';
import {
  hostApi,
  type HostStatusResponse,
  type TunnelProviderCatalogEntry,
} from '../../api';
import {
  settingsTheme,
  settingsMonoSx,
  settingsHelperSx,
  settingsTextFieldSx,
  settingsOverlineSx,
  settingsBtnGhostSx,
  settingsBtnDangerSx,
  settingsBtnPrimarySx,
  settingsStatusBadgeSx,
  settingsCardSx,
  settingsDangerCardSx,
} from '../../styles/settings-theme';
import { SettingsSectionHeader } from './SettingsSectionHeader';
import { alphaColor } from '../../theme';
import { copyToClipboard } from '../../utils/clipboard';

export interface HostTabProps {
  value?: HostConfig;
  onChange: (next: HostConfig) => void;
}

const EXPOSURE_LABEL: Record<string, { label: string; color: string }> = {
  LOCAL_ONLY: { label: 'Local only', color: settingsTheme.accent.signal },
  LAN_REACHABLE: { label: 'LAN reachable', color: settingsTheme.accent.amber },
  PUBLIC_DIRECT_UNSAFE: { label: 'Direct public (unsafe)', color: settingsTheme.accent.alert },
  PUBLIC_TUNNEL_SECURED: { label: 'Tunnel secured', color: settingsTheme.accent.cyan },
  DEGRADED: { label: 'Degraded', color: settingsTheme.accent.amber },
  DISABLED: { label: 'Disabled', color: settingsTheme.accent.alert },
  UNKNOWN: { label: 'Unknown', color: settingsTheme.text.dim },
};

const EXPOSURE_SURFACES: Array<{
  key: 'web' | 'voice' | 'telephonyWebhooks';
  title: string;
  why: string;
  defaultOn: boolean;
  risk: string;
}> = [
  {
    key: 'web',
    title: 'Web UI & API',
    why: 'Lets you open Agent-X from the public tunnel URL (still requires your login).',
    defaultOn: true,
    risk: 'Lowest risk when auth is on. Turn off if the tunnel is only for phone webhooks.',
  },
  {
    key: 'voice',
    title: 'Browser voice',
    why: 'Exposes the realtime voice WebSocket used by the in-app mic — not phone/VOIP.',
    defaultOn: false,
    risk: 'Off by default. Enable only when you need voice from outside this machine.',
  },
  {
    key: 'telephonyWebhooks',
    title: 'Telephony webhooks',
    why: 'Allows Twilio to POST signed call events to this install through the tunnel.',
    defaultOn: false,
    risk: 'Needed for inbound phone calls. Signature verification still applies.',
  },
];

export function mergeHostSettingsConfig(value?: HostConfig | null): HostConfig {
  return mergeHostConfig(defaultHostConfig(), value ?? undefined);
}

export function HostTab({ value, onChange }: HostTabProps) {
  const cfg = useMemo(() => mergeHostSettingsConfig(value), [value]);
  const [status, setStatus] = useState<HostStatusResponse | null>(null);
  const [tunnelCatalog, setTunnelCatalog] = useState<TunnelProviderCatalogEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [draftSecrets, setDraftSecrets] = useState<Record<string, Record<string, string>>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  const refresh = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([hostApi.status(), hostApi.providers()]);
      setStatus(s);
      setTunnelCatalog(p.tunnel ?? []);
    } catch {
      /* status may 503 before gateway init */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 8000);
    return () => clearInterval(id);
  }, [refresh]);

  const patch = (next: Partial<HostConfig>) => {
    onChange(mergeHostConfig(cfg, next));
  };

  const exposure = EXPOSURE_LABEL[status?.exposureState ?? 'UNKNOWN'] ?? EXPOSURE_LABEL.UNKNOWN!;
  const failedChecks = (status?.security.checks ?? []).filter((c) => !c.pass);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setFlash(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setFlash(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const copyPublicUrl = async () => {
    const url = status?.tunnel.publicUrl;
    if (!url) return;
    const ok = await copyToClipboard(url);
    setCopied(ok ? 'public-url' : null);
    if (ok) setTimeout(() => setCopied(null), 2000);
  };

  const downloadDiagnostics = async () => {
    setDownloading(true);
    setFlash(null);
    try {
      const bundle = await hostApi.diagnostics();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `agentx-host-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setFlash(err instanceof Error ? err.message : 'Failed to build diagnostics bundle');
    } finally {
      setDownloading(false);
    }
  };

  const exposureChecked = (key: 'web' | 'voice' | 'telephonyWebhooks') => {
    if (key === 'web') return cfg.exposure?.web !== false;
    if (key === 'voice') return Boolean(cfg.exposure?.voice);
    return Boolean(cfg.exposure?.telephonyWebhooks);
  };

  return (
    <Box>
      <SettingsSectionHeader
        icon={<PublicIcon sx={{ fontSize: 16 }} />}
        title="Host"
        subtitle="Public tunnel & what this install exposes — phone/VOIP lives under Channels"
      />

      {/* Status core */}
      <Box sx={{ ...settingsCardSx(exposure.color, true), mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
          <Box>
            <Typography sx={{ ...settingsOverlineSx, color: exposure.color, mb: 0.5 }}>
              Public edge status
            </Typography>
            <Typography sx={{ fontSize: '1.1rem', fontWeight: 700, color: settingsTheme.text.primary, ...settingsMonoSx }}>
              {exposure.label}
            </Typography>
            <Typography sx={{ ...settingsHelperSx, mt: 0.5 }}>
              {status?.network.loopbackUrl ?? '…'}
              {status?.tunnel.publicUrl ? ` · ${status.tunnel.publicUrl}` : ''}
            </Typography>
          </Box>
          <Box sx={settingsStatusBadgeSx(status?.tunnel.state === 'active' ? 'active' : 'idle')}>
            {status?.tunnel.state ?? 'disabled'}
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
          {status?.tunnel.publicUrl && (
            <>
              <Button
                size="small"
                sx={settingsBtnGhostSx}
                startIcon={<ContentCopyIcon sx={{ fontSize: 13 }} />}
                aria-label="Copy public URL"
                onClick={() => void copyPublicUrl()}
              >
                {copied === 'public-url' ? 'Copied!' : 'Copy public URL'}
              </Button>
              <Button
                size="small"
                sx={settingsBtnGhostSx}
                startIcon={<OpenInNewIcon sx={{ fontSize: 13 }} />}
                aria-label="Open public URL in a new tab"
                onClick={() => window.open(status.tunnel.publicUrl!, '_blank', 'noopener,noreferrer')}
              >
                Open public URL
              </Button>
            </>
          )}
          {status?.tunnel.state === 'active' && (
            <Button
              size="small"
              sx={settingsBtnGhostSx}
              disabled={busy === 'restart'}
              aria-label="Restart tunnel"
              startIcon={
                busy === 'restart'
                  ? reduceMotion
                    ? undefined
                    : <CircularProgress size={13} />
                  : <RestartAltIcon sx={{ fontSize: 13 }} />
              }
              onClick={() => void run('restart', () => hostApi.restartTunnel())}
            >
              {busy === 'restart' ? 'Restarting…' : 'Restart tunnel'}
            </Button>
          )}
        </Box>
      </Box>

      {flash && (
        <Alert severity="error" sx={{ mb: 2, bgcolor: alphaColor(settingsTheme.accent.alert, 0.08) }}>
          {flash}
        </Alert>
      )}

      {/* What to expose */}
      <Typography sx={{ ...settingsOverlineSx, mb: 1 }}>What the tunnel may expose</Typography>
      <Typography sx={{ ...settingsHelperSx, mb: 1.25 }}>
        The tunnel opens a door; these switches choose which surfaces are reachable through it.
        Keep unused surfaces off.
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' },
          gap: 1,
          mb: 2.5,
        }}
      >
        {EXPOSURE_SURFACES.map((surface) => {
          const on = exposureChecked(surface.key);
          return (
            <Box
              key={surface.key}
              sx={{
                ...settingsCardSx(on ? settingsTheme.accent.hud : undefined, on),
                mb: 0,
                p: 1.5,
                display: 'flex',
                flexDirection: 'column',
                gap: 0.75,
                minHeight: '100%',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, lineHeight: 1.3 }}>
                  {surface.title}
                </Typography>
                <Switch
                  size="small"
                  checked={on}
                  onChange={(_, checked) =>
                    patch({ exposure: { ...cfg.exposure!, [surface.key]: checked } })
                  }
                  inputProps={{ 'aria-label': `Expose ${surface.title}` }}
                  sx={{ mt: -0.5, mr: -0.75 }}
                />
              </Box>
              <Typography sx={{ ...settingsHelperSx, flex: 1 }}>{surface.why}</Typography>
              <Typography
                sx={{
                  ...settingsHelperSx,
                  fontSize: '0.65rem',
                  color: settingsTheme.text.dim,
                  borderTop: `1px solid ${settingsTheme.border.subtle}`,
                  pt: 0.75,
                }}
              >
                {surface.risk}
              </Typography>
            </Box>
          );
        })}
      </Box>

      {/* Tunnel */}
      <Typography sx={{ ...settingsOverlineSx, mb: 1 }}>Secure tunnel</Typography>
      <Typography sx={{ ...settingsHelperSx, mb: 1.25 }}>
        Without a tunnel, Agent-X stays on this machine / LAN. A tunnel gives providers (and you) a
        public HTTPS URL without opening router ports.
      </Typography>

      {tunnelCatalog
        .filter((e) => e.id === 'ngrok')
        .map((entry) => (
          <NgrokTunnelCard
            key={entry.id}
            entry={entry}
            cfg={cfg}
            status={status}
            busy={busy}
            drafts={draftSecrets[`tunnel:${entry.id}`] ?? {}}
            setDraft={(key, v) =>
              setDraftSecrets((prev) => ({
                ...prev,
                [`tunnel:${entry.id}`]: { ...prev[`tunnel:${entry.id}`], [key]: v },
              }))
            }
            clearDrafts={() =>
              setDraftSecrets((prev) => {
                const next = { ...prev };
                delete next[`tunnel:${entry.id}`];
                return next;
              })
            }
            patch={patch}
            run={run}
          />
        ))}

      {status?.network.lanUrls?.length ? (
        <Box sx={{ mb: 2.5 }}>
          <Typography sx={settingsOverlineSx}>Detected LAN</Typography>
          {status.network.lanUrls.map((url) => (
            <Typography key={url} sx={{ ...settingsMonoSx, fontSize: '0.7rem', color: settingsTheme.text.dim }}>
              {url}
            </Typography>
          ))}
        </Box>
      ) : null}

      {/* Controls that matter — merged former Security tab */}
      <Typography sx={{ ...settingsOverlineSx, mb: 1 }}>Public access controls</Typography>

      {(status?.security.failCount ?? 0) > 0 && (
        <Box sx={{ ...settingsCardSx(settingsTheme.accent.amber, true), mb: 1.25, p: 1.5 }}>
          <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, mb: 0.75 }}>
            Not ready · {status?.security.failCount ?? 0} check
            {(status?.security.failCount ?? 0) === 1 ? '' : 's'} failing
          </Typography>
          {failedChecks.map((check) => (
            <Box key={check.id} sx={{ py: 0.5, borderTop: `1px solid ${settingsTheme.border.subtle}` }}>
              <Typography sx={{ fontSize: '0.72rem', fontWeight: 600 }}>{check.label}</Typography>
              {check.remediation && (
                <Typography sx={{ ...settingsHelperSx, color: settingsTheme.accent.amber }}>
                  {check.remediation}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      )}

      {(status?.security.failCount ?? 0) === 0 && status && (
        <Typography sx={{ ...settingsHelperSx, mb: 1.25, color: settingsTheme.accent.signal }}>
          Security posture · {status.security.passCount} checks passing · ready for public access when
          tunnel is up
        </Typography>
      )}

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
        <Button
          size="small"
          sx={settingsBtnGhostSx}
          startIcon={<DownloadIcon sx={{ fontSize: 13 }} />}
          aria-label="Download host diagnostics bundle as JSON"
          disabled={downloading}
          onClick={() => void downloadDiagnostics()}
        >
          {downloading ? 'Preparing…' : 'Download diagnostics'}
        </Button>
      </Box>

      <Box sx={{ ...settingsDangerCardSx(), p: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap' }}>
          <Box sx={{ flex: 1, minWidth: 200 }}>
            <Typography sx={{ fontWeight: 700, fontSize: '0.8rem', mb: 0.25 }}>
              Emergency disable
            </Typography>
            <Typography sx={settingsHelperSx}>
              Immediately turns off public access and stops the active tunnel.
            </Typography>
          </Box>
          <Button
            size="small"
            sx={settingsBtnDangerSx}
            disabled={busy === 'emergency'}
            onClick={() => void run('emergency', () => hostApi.emergencyStop())}
          >
            {busy === 'emergency' ? <CircularProgress size={14} /> : 'Disable public access'}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}

function NgrokTunnelCard(props: {
  entry: TunnelProviderCatalogEntry;
  cfg: HostConfig;
  status: HostStatusResponse | null;
  busy: string | null;
  drafts: Record<string, string>;
  setDraft: (key: string, v: string) => void;
  clearDrafts: () => void;
  patch: (next: Partial<HostConfig>) => void;
  run: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const { entry, cfg, status, busy, drafts, setDraft, clearDrafts, patch, run } = props;
  const creds = cfg.tunnelProviders?.[entry.id]?.credentials ?? {};
  const tokenConfigured = Boolean(creds.authTokenConfigured || creds.authToken?.trim());
  const tunnelActive = status?.tunnel.state === 'active';
  const tokenDraft = drafts.authToken ?? '';

  const verify = () =>
    run(`verify-${entry.id}`, async () => {
      const result = await hostApi.testTunnelCredentials(entry.id, {
        authToken: tokenDraft.trim(),
      });
      if (!result.ok) {
        throw new Error(result.message ?? 'ngrok rejected this authtoken');
      }
      patch({
        provider: entry.id,
        tunnelProviders: {
          ...cfg.tunnelProviders,
          [entry.id]: {
            ...cfg.tunnelProviders?.[entry.id],
            credentials: {
              ...cfg.tunnelProviders?.[entry.id]?.credentials,
              authToken: tokenDraft.trim(),
            },
          },
        },
      });
      clearDrafts();
    });

  const toggleTunnel = () => {
    if (tunnelActive) {
      void run('stop', () => hostApi.stopTunnel());
      return;
    }
    void run('start', () => hostApi.startTunnel(entry.id));
  };

  const revoke = () =>
    run(`revoke-${entry.id}`, async () => {
      await hostApi.revokeTunnelCredentials(entry.id);
      patch({
        provider: null,
        publicAccess: false,
        tunnel: { ...cfg.tunnel, autostart: false },
        tunnelProviders: {
          ...cfg.tunnelProviders,
          [entry.id]: {
            ...cfg.tunnelProviders?.[entry.id],
            credentials: { authToken: '', authTokenConfigured: false },
          },
        },
      });
      clearDrafts();
    });

  return (
    <Box sx={settingsCardSx(entry.accent, tokenConfigured || tunnelActive)}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
        <Box>
          <Typography sx={{ fontWeight: 700, fontSize: '0.85rem' }}>{entry.name}</Typography>
          <Typography sx={settingsHelperSx}>{entry.tagline}</Typography>
        </Box>
        {tokenConfigured && (
          <Box sx={settingsStatusBadgeSx(tunnelActive ? 'active' : 'idle')}>
            {tunnelActive ? 'tunnel on' : 'ngrok verified'}
          </Box>
        )}
      </Box>

      {!tokenConfigured ? (
        <Box>
          <TextField
            size="small"
            fullWidth
            label="Authtoken"
            type="password"
            placeholder="Paste Your Authtoken from the ngrok dashboard"
            value={tokenDraft}
            onChange={(e) => setDraft('authToken', e.target.value)}
            sx={{ ...settingsTextFieldSx, mb: 1.25 }}
          />
          <Button
            size="small"
            sx={settingsBtnPrimarySx}
            disabled={busy === `verify-${entry.id}` || !tokenDraft.trim()}
            onClick={() => void verify()}
          >
            {busy === `verify-${entry.id}` ? <CircularProgress size={14} /> : 'Verify'}
          </Button>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button
            size="small"
            sx={tunnelActive ? settingsBtnGhostSx : settingsBtnPrimarySx}
            disabled={busy === 'start' || busy === 'stop'}
            onClick={toggleTunnel}
          >
            {busy === 'start' || busy === 'stop' ? (
              <CircularProgress size={14} />
            ) : tunnelActive ? (
              'Disable tunnel'
            ) : (
              'Enable tunnel'
            )}
          </Button>
          <Button
            size="small"
            sx={settingsBtnDangerSx}
            disabled={busy === `revoke-${entry.id}`}
            onClick={() => void revoke()}
          >
            {busy === `revoke-${entry.id}` ? <CircularProgress size={14} /> : 'Revoke authtoken'}
          </Button>
        </Box>
      )}

      {status?.tunnel.lastError && (
        <Typography sx={{ ...settingsHelperSx, color: settingsTheme.accent.amber, mt: 1 }}>
          {status.tunnel.lastError}
        </Typography>
      )}
    </Box>
  );
}
