/**
 * Wizard step 10 — "Channel Connect"
 *
 * Shows two channel cards (Telegram + WhatsApp) side by side, exactly like
 * the Voice Comm step's engine cards. Both channels are independent — the
 * user can connect both, one, or neither. The card selection just controls
 * which configuration panel is visible below.
 *
 * The inner Telegram/WhatsApp field components render WITHOUT their own
 * WizardStepShell — the shell is provided by this component so there's no
 * double header.
 */
import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TelegramIcon from '@mui/icons-material/Telegram';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import { WizardStepShell } from './wizard-step-shell';
import { wizardTheme, WIZARD_MONO } from './wizard-theme';
import { colors, alphaColor } from '../../theme';
import { WizardTelegramFields, type WizardTelegramLinkMeta } from './WizardTelegramStep';
import { WizardWhatsAppFields, type WizardWhatsAppLinkMeta } from './WizardWhatsAppStep';

export interface WizardChannelStepProps {
  // Telegram
  telegramLinked: boolean;
  initialTelegramBotLabel?: string | null;
  initialTelegramChatLabel?: string | null;
  onTelegramLinkedChange?: (linked: boolean, meta?: WizardTelegramLinkMeta) => void;

  // WhatsApp
  whatsappLinked: boolean;
  initialWhatsAppPhoneNumber?: string | null;
  initialWhatsAppPushName?: string | null;
  onWhatsAppLinkedChange?: (linked: boolean, meta?: WizardWhatsAppLinkMeta) => void;
}

type ChannelTab = 'telegram' | 'whatsapp';

export function WizardChannelStep({
  telegramLinked,
  initialTelegramBotLabel,
  initialTelegramChatLabel,
  onTelegramLinkedChange,
  whatsappLinked,
  initialWhatsAppPhoneNumber,
  initialWhatsAppPushName,
  onWhatsAppLinkedChange,
}: WizardChannelStepProps) {
  // Default to telegram tab, but if telegram is already linked and whatsapp
  // isn't, default to whatsapp so the user sees the unconfigured one first.
  const [activeTab, setActiveTab] = useState<ChannelTab>(
    telegramLinked && !whatsappLinked ? 'whatsapp' : 'telegram',
  );

  return (
    <WizardStepShell
      codename="MODULE · CHANNEL CONNECT"
      title="Establish Field Links"
      subtitle="Connect one or more messaging channels. Both can be active simultaneously."
    >
      <Box sx={{ position: 'relative', zIndex: 1 }}>
        {/* Two channel cards — same layout as Voice Comm engine cards */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 1.5, mb: 2 }}>
          {/* Telegram card */}
          <Box
            onClick={() => setActiveTab('telegram')}
            sx={{
              p: 1.5,
              borderRadius: 1,
              border: `1.5px solid ${activeTab === 'telegram' ? wizardTheme.accentOk : wizardTheme.panelBorder}`,
              bgcolor: activeTab === 'telegram' ? alphaColor(colors.accent.green, 0.08) : 'transparent',
              cursor: 'pointer',
              transition: 'border-color 0.15s, background-color 0.15s',
              '&:hover': activeTab !== 'telegram' ? { borderColor: wizardTheme.panelBorderStrong } : {},
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
              <TelegramIcon sx={{ fontSize: 16, color: '#0088cc' }} />
              <Typography sx={{ fontFamily: WIZARD_MONO, fontSize: '0.72rem', color: wizardTheme.text }}>
                Telegram
              </Typography>
              {telegramLinked && (
                <Box sx={{
                  width: 7, height: 7, borderRadius: '50%', bgcolor: wizardTheme.accentOk, ml: 'auto',
                }} />
              )}
            </Box>
            <Typography sx={{ fontSize: '0.58rem', color: wizardTheme.textSecondary }}>
              {telegramLinked ? 'Connected' : 'Bot token from @BotFather'}
            </Typography>
          </Box>

          {/* WhatsApp card */}
          <Box
            onClick={() => setActiveTab('whatsapp')}
            sx={{
              p: 1.5,
              borderRadius: 1,
              border: `1.5px solid ${activeTab === 'whatsapp' ? wizardTheme.accentOk : wizardTheme.panelBorder}`,
              bgcolor: activeTab === 'whatsapp' ? alphaColor(colors.accent.green, 0.08) : 'transparent',
              cursor: 'pointer',
              transition: 'border-color 0.15s, background-color 0.15s',
              '&:hover': activeTab !== 'whatsapp' ? { borderColor: wizardTheme.panelBorderStrong } : {},
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
              <WhatsAppIcon sx={{ fontSize: 16, color: '#25D366' }} />
              <Typography sx={{ fontFamily: WIZARD_MONO, fontSize: '0.72rem', color: wizardTheme.text }}>
                WhatsApp
              </Typography>
              {whatsappLinked && (
                <Box sx={{
                  width: 7, height: 7, borderRadius: '50%', bgcolor: wizardTheme.accentOk, ml: 'auto',
                }} />
              )}
            </Box>
            <Typography sx={{ fontSize: '0.58rem', color: wizardTheme.textSecondary }}>
              {whatsappLinked ? 'Connected' : 'QR scan'}
            </Typography>
          </Box>
        </Box>

        {/* Active channel's configuration fields (no shell — shell is above) */}
        {activeTab === 'telegram' ? (
          <WizardTelegramFields
            alreadyLinked={telegramLinked}
            initialBotLabel={initialTelegramBotLabel}
            initialChatLabel={initialTelegramChatLabel}
            onLinkedChange={onTelegramLinkedChange}
          />
        ) : (
          <WizardWhatsAppFields
            alreadyLinked={whatsappLinked}
            initialPhoneNumber={initialWhatsAppPhoneNumber}
            initialPushName={initialWhatsAppPushName}
            onLinkedChange={onWhatsAppLinkedChange}
          />
        )}
      </Box>
    </WizardStepShell>
  );
}
