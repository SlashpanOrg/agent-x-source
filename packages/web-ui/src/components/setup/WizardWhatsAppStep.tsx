/**
 * WhatsApp setup step for the first-run wizard.
 *
 * Reuses the same QR modal pattern from the Channels settings page, but
 * wrapped in the wizard step shell to match the Telegram step's visual style.
 */
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import RefreshIcon from '@mui/icons-material/Refresh';
import { bridges } from '../../api';
import type { WhatsAppSessionStatusResponse } from '../../api';
import { WizardStatusLine, WizardStepShell } from './wizard-step-shell';
import { wizardPrimaryBtnSx, wizardTheme, WIZARD_MONO } from './wizard-theme';
import { colors, alphaColor } from '../../theme';

export interface WizardWhatsAppLinkMeta {
  phoneNumber: string | null;
  pushName: string | null;
}

export interface WizardWhatsAppStepProps {
  onLinkedChange?: (linked: boolean, meta?: WizardWhatsAppLinkMeta) => void;
  /** Parent already marked this step complete — restore finished UI on revisit. */
  alreadyLinked?: boolean;
  initialPhoneNumber?: string | null;
  initialPushName?: string | null;
}

export function WizardWhatsAppStep({
  onLinkedChange,
  alreadyLinked,
  initialPhoneNumber,
  initialPushName,
}: WizardWhatsAppStepProps) {
  return (
    <WizardStepShell
      codename="MODULE · WHATSAPP LINK"
      title="WhatsApp Field Link"
      subtitle="Link a WhatsApp number via QR scan. ⚠️ Unofficial integrations carry a risk of account ban — use a number you can afford to lose."
      icon={<WhatsAppIcon sx={{ fontSize: 24 }} />}
    >
      <WizardWhatsAppFields
        alreadyLinked={alreadyLinked}
        initialPhoneNumber={initialPhoneNumber}
        initialPushName={initialPushName}
        onLinkedChange={onLinkedChange}
      />
    </WizardStepShell>
  );
}

/**
 * Inner content of the WhatsApp step — no shell wrapper. Used by
 * WizardChannelStep which provides its own shell.
 */
export function WizardWhatsAppFields({
  onLinkedChange,
  alreadyLinked,
  initialPhoneNumber,
  initialPushName,
}: WizardWhatsAppStepProps) {
  const [sessionStatus, setSessionStatus] = useState<WhatsAppSessionStatusResponse | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pollTimer, setPollTimer] = useState<ReturnType<typeof setInterval> | null>(null);
  const [linked, setLinked] = useState(Boolean(alreadyLinked));
  // Restore labels from saved wizard progress
  const [phoneNumber, setPhoneNumber] = useState<string | null>(initialPhoneNumber ?? null);
  const [pushName, setPushName] = useState<string | null>(initialPushName ?? null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const status = await bridges.whatsapp.status();
      setSessionStatus(status);
      if (status.status === 'ready') {
        setLinked(true);
        setPhoneNumber(status.phoneNumber ?? phoneNumber);
        setPushName(status.pushName ?? pushName);
        onLinkedChange?.(true, {
          phoneNumber: status.phoneNumber ?? phoneNumber,
          pushName: status.pushName ?? pushName,
        });
      }
    } catch {
      // Session not configured yet
    }
  };

  useEffect(() => {
    void fetchStatus();
  }, []);

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
      setSessionStatus((prev) => ({ ...prev, ...result, status: result.status } as WhatsAppSessionStatusResponse));

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
              setLinked(true);
              const phone = status.phoneNumber ?? phoneNumber;
              const name = status.pushName ?? pushName;
              setPhoneNumber(phone);
              setPushName(name);
              setSuccess(`WhatsApp linked${phone ? ` (${phone})` : ''}`);
              setLinking(false);
              onLinkedChange?.(true, { phoneNumber: phone, pushName: name });
            }
          } catch {
            // ignore polling errors
          }
        }, 3000);
        setPollTimer(timer);
      } else {
        setLinked(true);
        const phone = result.phoneNumber ?? phoneNumber;
        setPhoneNumber(phone);
        setSuccess(`WhatsApp linked${phone ? ` (${phone})` : ''}`);
        setQrOpen(false);
        onLinkedChange?.(true, { phoneNumber: phone, pushName: pushName });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start linking');
      setQrOpen(false);
    } finally {
      setLinking(false);
    }
  };

  const runtimeStatus = sessionStatus?.status ?? 'unknown';
  const isConnected = linked || runtimeStatus === 'ready';
  const isPaused = sessionStatus?.paused === true;

  const handleRetry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      const result = await bridges.whatsapp.retry();
      if (result.ok && !result.paused) {
        setLinked(true);
        setPhoneNumber(result.phoneNumber ?? phoneNumber);
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

  // Soft-paused state: show a clean disabled message with a retry button.
  if (isPaused) {
    return (
      <Box sx={{ position: 'relative', zIndex: 1, textAlign: 'center', py: 2 }}>
        <Typography sx={{ fontSize: '0.6rem', color: wizardTheme.textDim, fontFamily: WIZARD_MONO, lineHeight: 1.7, mb: 1.5 }}>
          {sessionStatus?.message ?? 'WhatsApp is temporarily disabled due to a connection failure. This may be due to a WhatsApp protocol update. You can click Retry to try again, or wait for the next Agent-X update.'}
        </Typography>
        <Button
          size="small"
          variant="outlined"
          startIcon={retrying ? <CircularProgress size={14} /> : <RefreshIcon sx={{ fontSize: 14 }} />}
          onClick={handleRetry}
          disabled={retrying}
          sx={{
            fontFamily: WIZARD_MONO,
            fontSize: '0.6rem',
            color: wizardTheme.accentOk,
            borderColor: alphaColor(colors.accent.green, 0.4),
            '&:hover': { borderColor: wizardTheme.accentOk, bgcolor: alphaColor(colors.accent.green, 0.06) },
            mb: 1.5,
          }}
        >
          {retrying ? 'Retrying…' : 'Retry Connection'}
        </Button>
        {retryError && (
          <Typography sx={{ fontSize: '0.52rem', color: wizardTheme.accentErr, fontFamily: WIZARD_MONO, mb: 1 }}>
            {retryError}
          </Typography>
        )}
        <Typography sx={{ fontSize: '0.52rem', color: wizardTheme.textDim, fontFamily: WIZARD_MONO }}>
          You can continue setup without WhatsApp and link it later from Settings → Channels.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ position: 'relative', zIndex: 1 }}>
      <WizardStatusLine label="PROTOCOL" value="WhatsApp Multi-Device" />
        <WizardStatusLine label="INBOUND" value="Text · media · voice notes" />
        <WizardStatusLine label="REQUIREMENT" value="QR scan" ok={isConnected} />

        {/* Status indicator */}
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 1,
          mt: 2, mb: 1.5, p: 1, borderRadius: 1,
          border: `1px solid ${isConnected ? wizardTheme.accentOk : wizardTheme.panelBorder}`,
          bgcolor: isConnected ? alphaColor(colors.accent.green, 0.06) : 'transparent',
        }}>
          <Box sx={{
            width: 8, height: 8, borderRadius: '50%',
            bgcolor: isConnected ? wizardTheme.accentOk
              : runtimeStatus === 'qr_ready' || runtimeStatus === 'pairing' ? wizardTheme.accentWarn
              : runtimeStatus === 'failed' ? wizardTheme.accentErr
              : wizardTheme.textDim,
          }} />
          <Typography sx={{ fontSize: '0.58rem', fontFamily: WIZARD_MONO, color: wizardTheme.textSecondary, textTransform: 'uppercase' }}>
            {isConnected
              ? `Connected${sessionStatus?.phoneNumber ? ` — ${sessionStatus.phoneNumber}` : ''}`
              : `Status: ${runtimeStatus}`}
          </Typography>
        </Box>

        {/* Error / success messages */}
        {error && (
          <Typography sx={{ fontSize: '0.58rem', color: wizardTheme.accentErr, mb: 1.5, fontFamily: WIZARD_MONO }}>
            ⚠ {error}
          </Typography>
        )}
        {success && (
          <Typography sx={{ fontSize: '0.58rem', color: wizardTheme.accentOk, mb: 1.5, fontFamily: WIZARD_MONO }}>
            ✓ {success}
          </Typography>
        )}

        {/* Action buttons */}
        {!isConnected && (
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <Button
              size="small"
              variant="contained"
              startIcon={<QrCode2Icon sx={{ fontSize: 14 }} />}
              onClick={handleConnect}
              disabled={linking}
              sx={wizardPrimaryBtnSx}
            >
              {linking ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
              Connect via QR
            </Button>
          </Box>
        )}

        {/* Linked state */}
        {isConnected && (
          <Box sx={{
            p: 1.5, borderRadius: 1,
            border: `1px solid ${wizardTheme.accentOk}`,
            bgcolor: alphaColor(colors.accent.green, 0.06),
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
          }}>
            <Box>
              <Typography sx={{ fontSize: '0.62rem', fontFamily: WIZARD_MONO, color: wizardTheme.accentOk, mb: 0.25 }}>
                WHATSAPP LINKED
              </Typography>
              <Typography sx={{ fontSize: '0.55rem', color: wizardTheme.textDim }}>
                {phoneNumber ?? sessionStatus?.phoneNumber ?? 'Number connected'}
                {(pushName ?? sessionStatus?.pushName) ? ` · ${pushName ?? sessionStatus?.pushName}` : ''}
              </Typography>
            </Box>
          </Box>
        )}

        {/* QR Code Modal */}
        <Dialog
          open={qrOpen}
          onClose={() => { if (!linking) setQrOpen(false); }}
          PaperProps={{ sx: {
            bgcolor: wizardTheme.panel,
            border: `1px solid ${wizardTheme.panelBorder}`,
            borderRadius: 1,
            maxWidth: 360,
            width: '100%',
          }}}
        >
          <DialogTitle sx={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: WIZARD_MONO, pb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
            <WhatsAppIcon sx={{ fontSize: 18, color: '#25D366' }} />
            Link WhatsApp
          </DialogTitle>
          <DialogContent>
            <Typography sx={{ fontSize: '0.6rem', color: wizardTheme.textDim, mb: 1.5, fontFamily: WIZARD_MONO }}>
              WhatsApp → Settings → Linked Devices → Link a Device
            </Typography>
            <Box sx={{
              display: 'flex', justifyContent: 'center', alignItems: 'center',
              width: 240, height: 240, bgcolor: '#fff', borderRadius: 1, p: 2,
              mx: 'auto',
            }}>
              {qrDataUrl ? (
                <Box component="img" src={qrDataUrl} alt="WhatsApp QR Code" sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={28} />
                  <Typography sx={{ fontSize: '0.55rem', color: wizardTheme.textDim, fontFamily: WIZARD_MONO }}>
                    Generating QR code...
                  </Typography>
                </Box>
              )}
            </Box>
            <Typography sx={{ fontSize: '0.52rem', color: wizardTheme.textDim, mt: 1.5, textAlign: 'center', fontFamily: WIZARD_MONO }}>
              Waiting for scan... keep this window open.
            </Typography>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button
              onClick={() => setQrOpen(false)}
              disabled={linking}
              sx={{ fontFamily: WIZARD_MONO, fontSize: '0.6rem', color: wizardTheme.textDim }}
            >
              Cancel
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
  );
}
