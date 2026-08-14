import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import ContrastIcon from '@mui/icons-material/Contrast';
import TuneIcon from '@mui/icons-material/Tune';
import { useState } from 'react';
import { useColorScheme } from '@mui/material/styles';
import type { AgentXConfig } from '../../api';
import { WorkspaceCard } from './WorkspaceCard';
import { SettingsCard } from './SettingsCard';
import { SettingsSectionHeader } from './SettingsSectionHeader';
import { DocumentParsersSection } from './KnowledgeTab';
import { OwnerIdentityFields } from './OwnerIdentityFields';
import { mergeUserConfig, normalizeOwnerNames, type UserGender } from '@agentx/shared';
import {
  settingsHelperSx,
  settingsTextFieldSx,
  settingsToggleGroupSx,
  settingsTheme,
} from '../../styles/settings-theme';

const MODES = ['dark', 'light', 'system'] as const;
type ThemeMode = (typeof MODES)[number];

interface Props {
  cfg: AgentXConfig;
  onChange: (cfg: AgentXConfig) => void;
}

export function GeneralTab({ cfg, onChange }: Props) {
  const { mode, setMode } = useColorScheme();
  const current = (mode ?? 'dark') as ThemeMode;
  const [nameInput, setNameInput] = useState('');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <SettingsSectionHeader
        icon={<TuneIcon sx={{ fontSize: 16 }} />}
        title="General"
        subtitle="Workspace, profile, appearance, and optional parsers"
      />

      <WorkspaceCard embedded />

      <SettingsCard title="Profile" subtitle="Callsign for you; public names for everyone else">
        <OwnerIdentityFields
          value={{
            callsign: cfg.user?.callsign ?? '',
            names: normalizeOwnerNames(cfg.user),
            nameInput,
            prefix: cfg.user?.prefix ?? '',
            gender: (cfg.user?.gender as UserGender | undefined) ?? '',
            email: cfg.user?.email ?? '',
          }}
          onChange={(next) => {
            setNameInput(next.nameInput);
            const prevNames = normalizeOwnerNames(cfg.user);
            const same =
              next.callsign === (cfg.user?.callsign ?? '')
              && next.prefix === (cfg.user?.prefix ?? '')
              && (next.gender || '') === (cfg.user?.gender ?? '')
              && next.email === (cfg.user?.email ?? '')
              && next.names.length === prevNames.length
              && next.names.every((n, i) => n === prevNames[i]);
            if (same) return;
            onChange({
              ...cfg,
              user: mergeUserConfig(cfg.user, {
                callsign: next.callsign,
                names: next.names,
                prefix: next.prefix,
                gender: next.gender || undefined,
                email: next.email,
              }),
            });
          }}
          textFieldSx={settingsTextFieldSx}
        />
      </SettingsCard>

      <SettingsCard title="Theme" subtitle="Applies instantly" accent={settingsTheme.accent.hud} active>
        <ToggleButtonGroup
          exclusive
          value={current}
          onChange={(_, v: ThemeMode | null) => {
            if (v) setMode(v);
          }}
          sx={{ ...settingsToggleGroupSx, mb: 0.75 }}
        >
          <ToggleButton value="dark">
            <DarkModeOutlinedIcon sx={{ fontSize: 14, mr: 0.75 }} />
            Dark
          </ToggleButton>
          <ToggleButton value="light">
            <LightModeOutlinedIcon sx={{ fontSize: 14, mr: 0.75 }} />
            Light
          </ToggleButton>
          <ToggleButton value="system">
            <ContrastIcon sx={{ fontSize: 14, mr: 0.75 }} />
            System
          </ToggleButton>
        </ToggleButtonGroup>
        <Typography sx={{ ...settingsHelperSx, fontFamily: "'JetBrains Mono', monospace", fontSize: '0.58rem' }}>
          Active: {current === 'system' ? 'system → auto' : current}
        </Typography>
      </SettingsCard>

      <DocumentParsersSection />
    </Box>
  );
}
