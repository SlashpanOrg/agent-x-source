import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SpeakerProfile } from '@agentx/shared';
import {
  settingsMonoSx,
  settingsTheme,
} from '../../styles/settings-theme';
import { alphaColor } from '../../theme';

interface SpeakerProfileRowProps {
  profile: SpeakerProfile;
  onSelect: (id: string) => void;
}

export function SpeakerProfileRow({ profile, onSelect }: SpeakerProfileRowProps) {
  const sampleCount = profile.samples?.length ?? (profile.sampleB64 ? 1 : 0);

  return (
    <Box
      onClick={() => onSelect(profile.id)}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        p: 1.25,
        minHeight: 76,
        border: `1px solid ${settingsTheme.border.default}`,
        borderRadius: 1,
        bgcolor: `${settingsTheme.bg.elevated}80`,
        cursor: 'pointer',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        '&:hover': {
          borderColor: settingsTheme.border.hud,
          boxShadow: `inset 0 0 0 1px ${alphaColor(settingsTheme.accent.hud, '20')}`,
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Typography sx={{
          ...settingsMonoSx,
          flex: 1,
          fontSize: '0.72rem',
          color: settingsTheme.text.primary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {profile.name}
        </Typography>
        {profile.isRoot && (
          <Box sx={{
            fontSize: '0.55rem',
            px: 0.5,
            py: 0.1,
            borderRadius: 0.5,
            bgcolor: `${settingsTheme.accent.signal}22`,
            color: settingsTheme.accent.signal,
            border: `1px solid ${settingsTheme.accent.signal}44`,
          }}>
            ROOT
          </Box>
        )}
      </Box>
      <Typography sx={{ fontSize: '0.55rem', color: settingsTheme.text.dim, mt: 0.5 }}>
        {sampleCount} sample{sampleCount === 1 ? '' : 's'}
        {profile.createdAt ? ` · ${new Date(profile.createdAt).toLocaleDateString()}` : ''}
      </Typography>
    </Box>
  );
}
