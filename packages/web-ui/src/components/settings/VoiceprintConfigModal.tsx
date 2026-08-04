import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Slider from '@mui/material/Slider';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import SettingsIcon from '@mui/icons-material/Settings';
import type { VoiceConfig } from '../../api';
import {
  settingsBtnPrimarySx,
  settingsHelperSx,
  settingsMonoSx,
  settingsTheme,
} from '../../styles/settings-theme';
import { colors, MONO } from '../../theme';

interface VoiceprintConfigModalProps {
  open: boolean;
  onClose: () => void;
  voiceConfig: VoiceConfig;
  onChange: (patch: Partial<VoiceConfig>) => void;
}

export function VoiceprintConfigModal({ open, onClose, voiceConfig, onChange }: VoiceprintConfigModalProps) {
  const threshold = voiceConfig.speaker?.identifyThreshold ?? 0.55;

  const handleChange = (value: number) => {
    onChange({
      speaker: {
        ...voiceConfig.speaker,
        identifyThreshold: value,
      },
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            bgcolor: colors.bg.secondary,
            border: `1px solid ${settingsTheme.accent.hud}`,
            borderRadius: 1.5,
            boxShadow: `0 0 40px ${settingsTheme.accent.hud}`,
            overflow: 'hidden',
          },
        },
        backdrop: { sx: { bgcolor: 'rgba(0,0,0,0.75)' } },
      }}
    >
      <Box sx={{ p: 2, position: 'relative' }}>
        <IconButton
          onClick={onClose}
          size="small"
          sx={{ position: 'absolute', top: 8, right: 8, color: settingsTheme.text.dim }}
        >
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <SettingsIcon sx={{ fontSize: 20, color: settingsTheme.accent.hud }} />
          <Typography sx={{ fontFamily: MONO, fontSize: '0.85rem', letterSpacing: '0.08em', color: settingsTheme.text.primary }}>
            VOICEPRINT CONFIG
          </Typography>
        </Box>

        <Typography sx={{ ...settingsHelperSx, fontSize: '0.62rem', color: settingsTheme.text.dim, mb: 2.5 }}>
          Tune how closely a voice must match a saved profile before it is recognized. Higher is stricter and less likely to accept impersonators.
        </Typography>

        <Box sx={{ mb: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.65rem', color: settingsTheme.text.primary }}>
              Match confidence threshold
            </Typography>
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.65rem', color: settingsTheme.text.secondary }}>
              {Math.round(threshold * 100)}%
            </Typography>
          </Box>
          <Slider
            value={threshold}
            onChange={(_, value) => handleChange(value as number)}
            min={0.1}
            max={0.95}
            step={0.05}
            valueLabelDisplay="auto"
            sx={{ color: settingsTheme.accent.hud }}
          />
          <Typography sx={{ ...settingsHelperSx, mt: 0.5 }}>
            55% is a balanced default. Raise it for stricter matching; lower it if known speakers are not recognised.
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
          <Button onClick={onClose} sx={{ ...settingsBtnPrimarySx, fontSize: '0.65rem', px: 2, py: 0.6 }}>
            Done
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
}
