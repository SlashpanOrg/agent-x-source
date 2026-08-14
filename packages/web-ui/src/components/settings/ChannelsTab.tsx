import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Switch from '@mui/material/Switch';
import Collapse from '@mui/material/Collapse';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Alert from '@mui/material/Alert';
import TelegramIcon from '@mui/icons-material/Telegram';
import ForumIcon from '@mui/icons-material/Forum';
import EmailIcon from '@mui/icons-material/Email';
import NotificationsIcon from '@mui/icons-material/Notifications';
import HeadphonesIcon from '@mui/icons-material/Headphones';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import RefreshIcon from '@mui/icons-material/Refresh';
import type { HostConfig, NotificationChannelsConfig } from '@agentx/shared/browser';
import { channels as channelsApi, bridges } from '../../api';
import type { WhatsAppSessionStatusResponse } from '../../api';
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
} from '../../styles/settings-theme';
import { SettingsSectionHeader } from './SettingsSectionHeader';
import { VoipChannelsPanel } from './VoipChannelsPanel';
import { brands } from '../../styles/brands';
import { colors, alphaColor } from '../../theme';

export interface ChannelsTabProps {
  value: NotificationChannelsConfig;
  onChange: (next: NotificationChannelsConfig) => void;
  hostConfig?: HostConfig;
  onHostChange?: (next: HostConfig) => void;
}

interface ChannelMeta {
  id: keyof NotificationChannelsConfig;
  name: string;
  tagline: string;
  accent: string;
  icon: React.ReactNode;
  instructions: string[];
}

const CHANNELS: ChannelMeta[] = [
  {
    id: 'telegram',
    name: 'Telegram',
    tagline: 'Chat with Agent-X via your bot',
    accent: brands.telegram,
    icon: <TelegramIcon sx={{ fontSize: 16 }} />,
    instructions: [
      'Create a bot with @BotFather and paste the token below.',
      'Send any message to your bot in Telegram, then click Verify token.',
    ],
  },
  {
    id: 'slack',
    name: 'Slack',
    tagline: 'Receive tasks and send alerts',
    accent: brands.slack,
    icon: <ForumIcon sx={{ fontSize: 16 }} />,
    instructions: [
      'Create a Slack app with Socket Mode enabled (bot + app tokens).',
      'Add an Incoming Webhook for automation alerts.',
    ],
  },
  {
    id: 'discord',
    name: 'Discord',
    tagline: 'Receive tasks and send alerts',
    accent: brands.discord,
    icon: <HeadphonesIcon sx={{ fontSize: 16 }} />,
    instructions: [
      'Discord Developer Portal → create a bot and copy the token.',
      'Server Integrations → Webhook URL for alerts.',
    ],
  },
  {
    id: 'email',
    name: 'Email',
    tagline: 'SMTP alerts',
    accent: settingsTheme.accent.hud,
    icon: <EmailIcon sx={{ fontSize: 16 }} />,
    instructions: [
      'Configure SMTP for automation summaries and alerts.',
    ],
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    tagline: 'Your eyes and hands on WhatsApp — Agent-X talks to you, not your contacts',
    accent: brands.whatsapp ?? '#25D366',
    icon: <WhatsAppIcon sx={{ fontSize: 16 }} />,
    instructions: [
      'Enable WhatsApp and click Connect. Scan the QR with WhatsApp → Settings → Linked Devices → Link a Device.',
      'Talk to Agent-X in WhatsApp → Message yourself. Agent-X replies there with an [Agent-X] prefix.',
      'Your contacts are not talking to the agent. Incoming chats brief you (self-chat + Notifications). Agent-X only texts them when you say so, or when a standing order you set fires.',
      '⚠️ Unofficial WhatsApp integrations carry a ban risk. Link a number you can afford to lose.',
    ],
  },
];

function getField(
  obj: NotificationChannelsConfig,
  section: keyof NotificationChannelsConfig,
  fieldKey: string,
): string {
  const block = obj[section] as Record<string, unknown> | undefined;
  const val = block?.[fieldKey];
  if (typeof val === 'number') return String(val);
  return typeof val === 'string' ? val : '';
}

function setField(
  obj: NotificationChannelsConfig,
  section: keyof NotificationChannelsConfig,
  fieldKey: string,
  raw: string,
  type?: 'number',
): NotificationChannelsConfig {
  const block = { ...(obj[section] as Record<string, unknown> | undefined) };
  block[fieldKey] = type === 'number' ? (raw ? Number(raw) : undefined) : (raw || undefined);
  return { ...obj, [section]: block };
}

function channelStatusLabel(id: keyof NotificationChannelsConfig, section: Record<string, unknown>): string {
  if (section.enabled !== true) return 'OFF';
  if (id === 'telegram') {
    if (section.botToken && section.chatId) return 'READY';
    if (section.botToken) return 'VERIFY';
    return 'SETUP';
  }
  if (id === 'slack') {
    if (section.botToken && section.appToken && section.webhookUrl) return 'READY';
    if (section.botToken || section.webhookUrl) return 'PARTIAL';
    return 'SETUP';
  }
  if (id === 'discord') {
    if (section.botToken && section.webhookUrl) return 'READY';
    if (section.botToken || section.webhookUrl) return 'PARTIAL';
    return 'SETUP';
  }
  if (id === 'email') {
    return section.smtpHost && section.toAddress ? 'READY' : 'SETUP';
  }
  if (id === 'whatsapp') {
    // WhatsApp status is determined at runtime by the session service, not
    // by config fields. The config-level status just shows whether it's
    // enabled. The runtime status (connected/disconnected/qr_ready) is
    // fetched separately and shown in the WhatsAppFields component.
    return section.enabled === true ? 'ENABLED' : 'OFF';
  }
  return 'SETUP';
}

function statusState(status: string): 'active' | 'warn' | 'idle' {
  if (status === 'READY' || status === 'ENABLED') return 'active';
  if (status === 'PARTIAL' || status === 'VERIFY') return 'warn';
  return 'idle';
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <Typography sx={{ ...settingsOverlineSx, fontSize: '0.52rem', letterSpacing: '1.5px', mb: 0.5 }}>
      {children}
      {required && <Box component="span" sx={{ color: settingsTheme.accent.alert, ml: 0.5 }}>*</Box>}
    </Typography>
  );
}

function CredentialField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required,
  gridColumn,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password' | 'number';
  placeholder?: string;
  required?: boolean;
  gridColumn?: string;
}) {
  return (
    <Box sx={{ gridColumn, display: 'flex', flexDirection: 'column' }}>
      <FieldLabel required={required}>{label}</FieldLabel>
      <TextField
        size="small"
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        sx={{ ...settingsTextFieldSx }}
      />
    </Box>
  );
}


function TelegramFields({
  value,
  onChange,
}: {
  value: NotificationChannelsConfig;
  onChange: (next: NotificationChannelsConfig) => void;
}) {
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [greeting, setGreeting] = useState(false);
  const [greetingMsg, setGreetingMsg] = useState<string | null>(null);

  const chatId = getField(value, 'telegram', 'chatId');
  const allowedUserId = getField(value, 'telegram', 'allowedUserIds').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)[0] ?? '';
  const hasToken = Boolean(getField(value, 'telegram', 'botToken').trim());

  const handleVerify = async () => {
    const token = getField(value, 'telegram', 'botToken');
    if (!token) {
      setVerifyMsg('Enter a bot token first.');
      return;
    }
    setVerifying(true);
    setVerifyMsg(null);
    try {
      const result = await channelsApi.discoverTelegram(token, chatId || undefined);
      if (!result.ok) {
        setVerifyMsg(result.error ?? 'Verification failed');
        return;
      }
      const botLabel = result.botUsername ? `@${result.botUsername}` : result.botName ?? 'Bot';
      if (result.error && !result.saved) {
        setVerifyMsg(result.error);
        return;
      }
      if (!result.chats?.length) {
        setVerifyMsg(`Token valid (${botLabel}). Open Telegram, send a private message to your bot, then verify again.`);
        return;
      }
      const ownerId = result.allowedUserId
        ?? result.chats.find((c) => c.type === 'private')?.userId
        ?? result.chats.find((c) => c.type === 'private')?.id;
      if (!ownerId || !result.chatId) {
        setVerifyMsg(result.error ?? 'Message your bot in a private chat, then verify again.');
        return;
      }
      const chat = result.chats.find((c) => c.id === result.chatId) ?? result.chats[0]!;
      const next = {
        ...value,
        telegram: {
          ...value.telegram,
          enabled: true,
          inbound: true,
          outbound: true,
          botToken: token,
          chatId: result.chatId,
          allowedUserIds: ownerId,
        },
      };
      onChange(next);
      setVerifyMsg(
        result.saved
          ? `Connected (${botLabel} → ${chat.title}). Owner user ID ${ownerId} locked.`
          : `Connected (${botLabel} → ${chat.title}). Owner user ID ${ownerId}.`,
      );
    } catch (e) {
      setVerifyMsg(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const handleGreeting = async () => {
    if (!hasToken) {
      setGreetingMsg('Enter a bot token first.');
      return;
    }
    if (!chatId) {
      setGreetingMsg('Verify token and link a chat before sending a greeting.');
      return;
    }
    setGreeting(true);
    setGreetingMsg(null);
    try {
      const result = await channelsApi.sendTelegramGreeting(
        getField(value, 'telegram', 'botToken'),
        chatId || allowedUserId,
      );
      setGreetingMsg(result.ok ? `Greeting sent. ${result.message ?? ''}` : (result.error ?? 'Failed to send greeting'));
    } catch (e) {
      setGreetingMsg(e instanceof Error ? e.message : 'Failed to send greeting');
    } finally {
      setGreeting(false);
    }
  };

  const message = greetingMsg ?? verifyMsg;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
        <CredentialField
          label="Bot Token"
          value={getField(value, 'telegram', 'botToken')}
          onChange={(v) => onChange(setField(value, 'telegram', 'botToken', v))}
          type="password"
          placeholder="123456:ABC-DEF..."
          required
          gridColumn="1 / -1"
        />
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
        <Button
          size="small"
          onClick={() => { void handleVerify(); }}
          disabled={verifying || !hasToken}
          sx={settingsBtnPrimarySx}
        >
          {verifying ? <CircularProgress size={12} sx={{ mr: 0.75 }} /> : null}
          Verify Token
        </Button>
        <Button
          size="small"
          onClick={() => { void handleGreeting(); }}
          disabled={greeting || !hasToken || !chatId}
          sx={settingsBtnGhostSx}
        >
          {greeting ? <CircularProgress size={12} sx={{ mr: 0.75 }} /> : null}
          Send Greeting
        </Button>
        {message && (
          <Typography sx={{ fontSize: '0.58rem', color: settingsTheme.text.dim, ...settingsMonoSx, flex: 1, minWidth: 160 }}>
            {message}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

// ─── WhatsApp Fields ─────────────────────────────────────────────────────

function WhatsAppFields() {
  const [sessionStatus, setSessionStatus] = useState<WhatsAppSessionStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pollTimer, setPollTimer] = useState<ReturnType<typeof setInterval> | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  // Fetch status on mount and poll periodically while the tab is visible.
  // This ensures the settings page reflects the current connection state
  // even if WhatsApp was connected via the setup wizard or reconnected
  // after a transient failure.
  const fetchStatus = async () => {
    try {
      const status = await bridges.whatsapp.status();
      setSessionStatus(status);
    } catch {
      // Session not configured yet — that's fine
    }
  };

  useEffect(() => {
    void fetchStatus();
    // Poll every 5 seconds while the component is mounted so the status
    // stays fresh (e.g. if WhatsApp connects via the wizard or reconnects
    // after a transient disconnection).
    const timer = setInterval(() => void fetchStatus(), 5_000);
    return () => clearInterval(timer);
  }, []);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [pollTimer]);

  const handleConnect = async () => {
    setLinking(true);
    setError(null);
    setSuccess(null);
    setQrOpen(true);
    try {
      const result = await bridges.whatsapp.link();
      if (result.qrDataUrl) {
        setQrDataUrl(result.qrDataUrl);
      }
      setSessionStatus({ ...sessionStatus, status: result.status, qrDataUrl: result.qrDataUrl } as WhatsAppSessionStatusResponse);

      // If not immediately ready, start polling for status updates
      if (result.status !== 'ready') {
        const timer = setInterval(async () => {
          try {
            const status = await bridges.whatsapp.status();
            setSessionStatus(status);
            if (status.qrDataUrl) setQrDataUrl(status.qrDataUrl);
            if (status.status === 'ready') {
              clearInterval(timer);
              setPollTimer(null);
              setQrOpen(false);
              setSuccess(`WhatsApp linked${status.phoneNumber ? ` (${status.phoneNumber})` : ''}`);
              setLinking(false);
            }
          } catch {
            // ignore polling errors
          }
        }, 3000);
        setPollTimer(timer);
      } else {
        setSuccess(`WhatsApp linked${result.phoneNumber ? ` (${result.phoneNumber})` : ''}`);
        setQrOpen(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start linking');
      setQrOpen(false);
    } finally {
      setLinking(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    setError(null);
    try {
      await bridges.whatsapp.stop();
      setSuccess('WhatsApp disconnected. Your link is saved — Connect restores it without a new QR.');
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to stop session');
    } finally {
      setLoading(false);
    }
  };

  const handleUnlink = async () => {
    setLoading(true);
    setError(null);
    try {
      await bridges.whatsapp.unlink();
      setSuccess('WhatsApp unlinked — all credentials purged');
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to unlink');
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      const result = await bridges.whatsapp.retry();
      if (result.ok && !result.paused) {
        setSuccess('WhatsApp reconnected successfully');
        await fetchStatus();
      } else {
        setRetryError(result.error ?? 'Retry failed — WhatsApp is still unable to connect');
      }
    } catch (e) {
      setRetryError(e instanceof Error ? e.message : 'Failed to retry connection');
    } finally {
      setRetrying(false);
    }
  };

  const runtimeStatus = sessionStatus?.status ?? 'unknown';
  const isConnected = runtimeStatus === 'ready';
  const isPaused = sessionStatus?.paused === true;

  // Soft-paused state: show a clean disabled overlay instead of the normal UI.
  if (isPaused) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box sx={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 1, py: 3, px: 2,
          border: `1px solid ${settingsTheme.border.subtle}`,
          borderRadius: '8px',
          bgcolor: alphaColor(colors.ink, 0.02),
          textAlign: 'center',
        }}>
          <PauseCircleIcon sx={{ fontSize: 32, color: settingsTheme.text.dim }} />
          <Typography sx={{ ...settingsMonoSx, fontSize: '0.7rem', color: settingsTheme.text.primary, fontWeight: 600 }}>
            WhatsApp Temporarily Disabled
          </Typography>
          <Typography sx={{ fontSize: '0.6rem', color: settingsTheme.text.dim, lineHeight: 1.6, maxWidth: 320 }}>
            {sessionStatus?.message ?? 'WhatsApp is temporarily disabled due to a connection failure. This may be due to a WhatsApp protocol update. You can click Retry to try again, or wait for the next Agent-X update.'}
          </Typography>
          <Button
            size="small"
            variant="outlined"
            startIcon={retrying ? <CircularProgress size={14} /> : <RefreshIcon sx={{ fontSize: 14 }} />}
            onClick={handleRetry}
            disabled={retrying}
            sx={{
              mt: 1,
              ...settingsBtnGhostSx,
              borderColor: settingsTheme.accent.signal,
              color: settingsTheme.accent.signal,
              '&:hover': { borderColor: settingsTheme.accent.signal, bgcolor: alphaColor(settingsTheme.accent.signal, 0.08) },
            }}
          >
            {retrying ? 'Retrying…' : 'Retry Connection'}
          </Button>
          {retryError && (
            <Typography sx={{ fontSize: '0.55rem', color: settingsTheme.accent.alert, mt: 0.5, maxWidth: 320 }}>
              {retryError}
            </Typography>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {/* Runtime status indicator */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1,
        border: `1px solid ${settingsTheme.border.subtle}`,
        borderRadius: '4px', px: 1.25, py: 0.75,
      }}>
        <Box sx={{
          width: 8, height: 8, borderRadius: '50%',
          bgcolor: isConnected ? settingsTheme.accent.signal
            : runtimeStatus === 'qr_ready' || runtimeStatus === 'pairing' ? settingsTheme.accent.amber
            : runtimeStatus === 'failed' ? settingsTheme.accent.alert
            : settingsTheme.text.dim,
        }} />
        <Typography sx={{ fontSize: '0.6rem', color: settingsTheme.text.dim, ...settingsMonoSx, textTransform: 'uppercase' }}>
          {isConnected ? `Connected${sessionStatus?.phoneNumber ? ` — ${sessionStatus.phoneNumber}` : ''}` : `Status: ${runtimeStatus}`}
        </Typography>
        {sessionStatus?.pushName && (
          <Typography sx={{ fontSize: '0.55rem', color: settingsTheme.text.dim, ml: 'auto' }}>
            {sessionStatus.pushName}
          </Typography>
        )}
      </Box>

      {/* Alerts */}
      {error && <Alert severity="error" sx={{ fontSize: '0.65rem', py: 0.5 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ fontSize: '0.65rem', py: 0.5 }} onClose={() => setSuccess(null)}>{success}</Alert>}

      {/* Action buttons */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {!isConnected && (
          <Button
            size="small"
            variant="contained"
            startIcon={<QrCode2Icon sx={{ fontSize: 14 }} />}
            onClick={handleConnect}
            disabled={linking}
            sx={settingsBtnPrimarySx}
          >
            {linking ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
            Connect
          </Button>
        )}
        {isConnected && (
          <Button
            size="small"
            startIcon={<DeleteOutlineIcon sx={{ fontSize: 14 }} />}
            onClick={handleStop}
            disabled={loading}
            sx={settingsBtnGhostSx}
          >
            Stop
          </Button>
        )}
        <Button
          size="small"
          startIcon={<DeleteOutlineIcon sx={{ fontSize: 14 }} />}
          onClick={handleUnlink}
          disabled={loading || !sessionStatus}
          sx={settingsBtnDangerSx}
        >
          Unlink
        </Button>
      </Box>

      {/* QR Code Modal */}
      <Dialog
        open={qrOpen}
        onClose={() => { if (!linking) setQrOpen(false); }}
        PaperProps={{ sx: {
          bgcolor: settingsTheme.bg.void,
          border: `1px solid ${settingsTheme.border.default}`,
          borderRadius: '6px',
          maxWidth: 380,
          width: '100%',
        }}}
      >
        <DialogTitle sx={{ fontSize: '0.85rem', fontWeight: 700, pb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <WhatsAppIcon sx={{ fontSize: 18, color: '#25D366' }} />
          Link WhatsApp
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.text.dim, mb: 1.5 }}>
            Scan this QR code with your phone:
          </Typography>
          <Typography sx={{ fontSize: '0.6rem', color: settingsTheme.text.dim, mb: 1.5, ...settingsMonoSx }}>
            WhatsApp → Settings → Linked Devices → Link a Device
          </Typography>
          <Box sx={{
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            width: 256, height: 256, bgcolor: '#fff', borderRadius: '4px', p: 2,
            mx: 'auto',
          }}>
            {qrDataUrl ? (
              <Box component="img" src={qrDataUrl} alt="WhatsApp QR Code" sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={32} />
                <Typography sx={{ fontSize: '0.6rem', color: settingsTheme.text.dim }}>
                  Generating QR code...
                </Typography>
              </Box>
            )}
          </Box>
          <Typography sx={{ fontSize: '0.55rem', color: settingsTheme.text.dim, mt: 1.5, textAlign: 'center' }}>
            Waiting for scan... keep this window open.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setQrOpen(false)}
            disabled={linking}
            sx={{ color: settingsTheme.text.dim }}
          >
            Cancel
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function ChannelCard({
  meta,
  value,
  onChange,
}: {
  meta: ChannelMeta;
  value: NotificationChannelsConfig;
  onChange: (next: NotificationChannelsConfig) => void;
}) {
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);
  const [clearError, setClearError] = useState('');
  const [clearSuccess, setClearSuccess] = useState('');
  const section = (value[meta.id] ?? {}) as Record<string, unknown>;
  const enabled = section.enabled === true;
  const status = channelStatusLabel(meta.id, section);

  const handleClearConfirm = async () => {
    setClearLoading(true);
    setClearError('');
    setClearSuccess('');
    try {
      const result = await bridges.clearConversation(String(meta.id));
      setClearSuccess(result.message ?? `Cleared ${meta.name} conversation`);
      setClearOpen(false);
    } catch (e) {
      setClearError(e instanceof Error ? e.message : 'Failed to clear conversation');
    } finally {
      setClearLoading(false);
    }
  };

  const enableSection = (checked: boolean) => ({
    ...section,
    enabled: checked,
    inbound: true,
    outbound: true,
  });

  return (
    <Box sx={settingsCardSx(meta.accent, enabled)}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: enabled ? 1.75 : 0 }}>
        {/* Header — always visible */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
            <Box sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, borderRadius: '4px',
              bgcolor: `${meta.accent}14`,
              color: meta.accent,
              border: `1px solid ${meta.accent}44`,
            }}>
              {meta.icon}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: settingsTheme.text.primary, lineHeight: 1.3 }}>
                {meta.name}
              </Typography>
              <Typography sx={{ fontSize: '0.55rem', color: settingsTheme.text.dim, ...settingsMonoSx, letterSpacing: '0.5px' }}>
                {meta.tagline}
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0 }}>
            <Box sx={{ ...settingsStatusBadgeSx(statusState(status)), flexShrink: 0 }}>
              {status}
            </Box>
            <Switch
              size="small"
              checked={enabled}
              onChange={(e) => onChange({ ...value, [meta.id]: enableSection(e.target.checked) })}
              sx={{
                '& .MuiSwitch-switchBase.Mui-checked': { color: meta.accent },
                '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: meta.accent },
              }}
            />
          </Box>
        </Box>

        {/* Expanded configuration */}
        <Collapse in={enabled}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
            {/* Instructions */}
            <Box sx={{
              border: `1px solid ${settingsTheme.border.subtle}`,
              borderRadius: '4px',
              bgcolor: settingsTheme.bg.void,
              overflow: 'hidden',
            }}>
              <Box
                onClick={() => setInstructionsOpen((o) => !o)}
                sx={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  px: 1.25, py: 0.75, cursor: 'pointer', userSelect: 'none',
                }}
              >
                <Typography sx={{ ...settingsOverlineSx, fontSize: '0.5rem', letterSpacing: '1.5px' }}>
                  Setup Instructions
                </Typography>
                <ExpandMoreIcon sx={{
                  fontSize: 14, color: settingsTheme.text.dim,
                  transform: instructionsOpen ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.28s ease',
                }} />
              </Box>
              <Collapse in={instructionsOpen}>
                <Box sx={{ px: 1.25, pb: 1 }}>
                  {meta.instructions.map((line, i) => (
                    <Typography key={i} sx={{ ...settingsHelperSx, fontSize: '0.6rem', mb: 0.35 }}>
                      {i + 1}. {line}
                    </Typography>
                  ))}
                </Box>
              </Collapse>
            </Box>

            {/* Alerts */}
            {clearSuccess && (
              <Alert severity="success" sx={{ fontSize: '0.65rem', py: 0.5 }} onClose={() => setClearSuccess('')}>
                {clearSuccess}
              </Alert>
            )}
            {clearError && (
              <Alert severity="error" sx={{ fontSize: '0.65rem', py: 0.5 }} onClose={() => setClearError('')}>
                {clearError}
              </Alert>
            )}

            {/* Credentials */}
            {meta.id === 'telegram' && <TelegramFields value={value} onChange={onChange} />}

            {meta.id === 'slack' && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
                  <CredentialField
                    label="Bot Token"
                    value={getField(value, 'slack', 'botToken')}
                    onChange={(v) => onChange(setField(value, 'slack', 'botToken', v))}
                    type="password"
                    placeholder="xoxb-..."
                  />
                  <CredentialField
                    label="App Token"
                    value={getField(value, 'slack', 'appToken')}
                    onChange={(v) => onChange(setField(value, 'slack', 'appToken', v))}
                    type="password"
                    placeholder="xapp-..."
                  />
                  <CredentialField
                    label="Webhook URL"
                    value={getField(value, 'slack', 'webhookUrl')}
                    onChange={(v) => onChange(setField(value, 'slack', 'webhookUrl', v))}
                    type="password"
                    placeholder="https://hooks.slack.com/..."
                    gridColumn="1 / -1"
                  />
                </Box>
              </Box>
            )}

            {meta.id === 'discord' && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
                  <CredentialField
                    label="Bot Token"
                    value={getField(value, 'discord', 'botToken')}
                    onChange={(v) => onChange(setField(value, 'discord', 'botToken', v))}
                    type="password"
                    placeholder="MTQ..."
                  />
                  <CredentialField
                    label="Channel ID (optional)"
                    value={getField(value, 'discord', 'channelId')}
                    onChange={(v) => onChange(setField(value, 'discord', 'channelId', v))}
                    placeholder="Optional"
                  />
                  <CredentialField
                    label="Webhook URL"
                    value={getField(value, 'discord', 'webhookUrl')}
                    onChange={(v) => onChange(setField(value, 'discord', 'webhookUrl', v))}
                    type="password"
                    placeholder="https://discord.com/api/webhooks/..."
                    gridColumn="1 / -1"
                  />
                </Box>
              </Box>
            )}

            {meta.id === 'email' && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
                  <CredentialField
                    label="SMTP Host"
                    value={getField(value, 'email', 'smtpHost')}
                    onChange={(v) => onChange(setField(value, 'email', 'smtpHost', v))}
                    placeholder="smtp.example.com"
                  />
                  <CredentialField
                    label="Port"
                    value={getField(value, 'email', 'smtpPort')}
                    onChange={(v) => onChange(setField(value, 'email', 'smtpPort', v, 'number'))}
                    type="number"
                    placeholder="587"
                  />
                  <CredentialField
                    label="Username"
                    value={getField(value, 'email', 'smtpUser')}
                    onChange={(v) => onChange(setField(value, 'email', 'smtpUser', v))}
                  />
                  <CredentialField
                    label="Password"
                    value={getField(value, 'email', 'smtpPassword')}
                    onChange={(v) => onChange(setField(value, 'email', 'smtpPassword', v))}
                    type="password"
                  />
                  <CredentialField
                    label="From"
                    value={getField(value, 'email', 'fromAddress')}
                    onChange={(v) => onChange(setField(value, 'email', 'fromAddress', v))}
                    placeholder="agent@example.com"
                  />
                  <CredentialField
                    label="To"
                    value={getField(value, 'email', 'toAddress')}
                    onChange={(v) => onChange(setField(value, 'email', 'toAddress', v))}
                    placeholder="you@example.com"
                  />
                </Box>
              </Box>
            )}

            {meta.id === 'whatsapp' && <WhatsAppFields />}

            {/* Danger zone — only for Telegram */}
            {meta.id === 'telegram' && (
            <Box sx={{
              border: `1px dashed ${settingsTheme.border.alert}`,
              borderRadius: '4px',
              bgcolor: `${settingsTheme.accent.alert}08`,
              p: 1.25,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5,
              flexWrap: 'wrap',
            }}>
              <Box>
                <Typography sx={{ ...settingsOverlineSx, fontSize: '0.5rem', color: settingsTheme.accent.alert, mb: 0.25 }}>
                  Danger Zone
                </Typography>
                <Typography sx={{ fontSize: '0.58rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
                  Wipe all conversation history and session data for this channel.
                </Typography>
              </Box>
              <Button
                size="small"
                startIcon={<DeleteOutlineIcon sx={{ fontSize: 14 }} />}
                onClick={() => setClearOpen(true)}
                sx={settingsBtnDangerSx}
              >
                Clear Conversation
              </Button>
            </Box>
            )}
          </Box>
        </Collapse>
      </Box>
      
      <Dialog
        open={clearOpen}
        onClose={() => { if (!clearLoading) setClearOpen(false); }}
        PaperProps={{ sx: {
          bgcolor: settingsTheme.bg.void,
          border: `1px solid ${settingsTheme.border.default}`,
          borderRadius: '6px',
          maxWidth: 420,
          width: '100%',
        }}}
      >
        <DialogTitle sx={{ fontSize: '0.85rem', fontWeight: 700, pb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          {meta.icon}
          Clear {meta.name} Conversation
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: settingsTheme.text.dim, mt: 1, fontSize: '0.72rem' }}>
            This will permanently delete <strong>all messages, tool executions, and conversation history</strong> for {meta.name}.
            The agent will start fresh with no memory of prior conversations. This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setClearOpen(false)} sx={{ color: settingsTheme.text.dim }}>Cancel</Button>
          <Button
            onClick={handleClearConfirm}
            variant="contained"
            disabled={clearLoading}
            sx={{ bgcolor: settingsTheme.accent.alert, color: '#fff' }}
          >
            {clearLoading ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
            Clear All
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export function mergeChannelsConfig(raw?: NotificationChannelsConfig | null): NotificationChannelsConfig {
  return {
    telegram: { enabled: false, inbound: true, outbound: true, ...raw?.telegram },
    slack: { enabled: false, inbound: true, outbound: true, ...raw?.slack },
    discord: { enabled: false, inbound: true, outbound: true, ...raw?.discord },
    email: { enabled: false, inbound: false, outbound: true, ...raw?.email },
    whatsapp: { enabled: false, inbound: true, outbound: true, ...raw?.whatsapp },
  };
}

export function ChannelsTab({ value, onChange, hostConfig, onHostChange }: ChannelsTabProps) {
  const cfg = mergeChannelsConfig(value);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <SettingsSectionHeader
        icon={<NotificationsIcon sx={{ fontSize: 16 }} />}
        title="Channels"
        subtitle="Messaging and phone — how Agent-X talks to the outside world"
      />

      <Typography sx={{ ...settingsOverlineSx, mt: 0.5 }}>Messaging</Typography>
      <Typography sx={{ ...settingsHelperSx, mb: 0.5 }}>
        Chat and alert surfaces (Telegram, Slack, Discord, Email, WhatsApp).
      </Typography>

      {CHANNELS.map((meta) => (
        <ChannelCard key={String(meta.id)} meta={meta} value={cfg} onChange={onChange} />
      ))}

      <Typography sx={{ ...settingsHelperSx, mt: 0.5, mb: 1 }}>
        Enable a channel to configure credentials. Telegram verifies and saves automatically on success.
        Other changes save automatically.
      </Typography>

      <Typography sx={{ ...settingsOverlineSx, mt: 1 }}>Phone / VOIP</Typography>
      <Typography sx={{ ...settingsHelperSx, mb: 0.5 }}>
        Carrier phone calls via Twilio. Public webhook reachability is configured under Host.
      </Typography>

      {hostConfig && onHostChange ? (
        <VoipChannelsPanel hostConfig={hostConfig} onHostChange={onHostChange} />
      ) : (
        <Typography sx={settingsHelperSx}>Host config unavailable — reload Settings.</Typography>
      )}
    </Box>
  );
}
