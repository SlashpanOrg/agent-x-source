import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ThinkingOrb } from 'thinking-orbs';
import { colors, getActiveScheme } from '../theme';

/** Subtle agent-side activity indicator while a turn is still running. */
export function AgentTurnLoader({ label }: { label?: string }) {
  const safeLabel = label?.trim();
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        mb: 2,
        ml: 0.25,
      }}
    >
      <ThinkingOrb
        state='working'
        size={20}
        theme={getActiveScheme() === 'dark' ? 'dark' : 'light'}
        aria-label={safeLabel || 'Working…'}
        style={{ flexShrink: 0 }}
      />
      <Typography
        sx={{
          fontSize: '0.7rem',
          color: colors.text.dim,
          fontFamily: 'Inter, sans-serif',
          fontStyle: safeLabel ? 'normal' : 'italic',
          maxWidth: 520,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {safeLabel || 'Working...'}
      </Typography>
    </Box>
  );
}
