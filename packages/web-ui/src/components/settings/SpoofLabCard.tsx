import { useState } from 'react';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import ScienceIcon from '@mui/icons-material/Science';
import {
  settingsBtnGhostSx,
  settingsHelperSx,
  settingsTheme,
} from '../../styles/settings-theme';
import { SettingsCard } from './SettingsCard';
import { SpoofLabModal } from './SpoofLabModal';

interface SpoofLabCardProps {
  ecapaInstalled: boolean;
}

export function SpoofLabCard({ ecapaInstalled }: SpoofLabCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <SettingsCard title="Spoof Lab" subtitle="Fun / beta">
        <Typography sx={{ ...settingsHelperSx, fontSize: '0.6rem', color: settingsTheme.text.dim, mb: 1 }}>
          Try to spoof a saved voice profile and see if the recognition engine cracks it.
        </Typography>
        <Button
          onClick={() => setOpen(true)}
          startIcon={<ScienceIcon sx={{ fontSize: 16, color: settingsTheme.accent.hud }} />}
          sx={{ ...settingsBtnGhostSx, fontSize: '0.62rem', py: 0.5 }}
        >
          Open Spoof Lab
        </Button>
      </SettingsCard>

      <SpoofLabModal open={open} onClose={() => setOpen(false)} ecapaInstalled={ecapaInstalled} />
    </>
  );
}
