import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ThinkingOrb } from 'thinking-orbs';
import { colors, getActiveScheme } from '../theme';

type OrbState = 'working' | 'searching' | 'solving' | 'listening' | 'composing' | 'shaping';

function deriveOrbState(label: string): OrbState {
  const l = label.toLowerCase();
  if (l.includes('search')) return 'searching';
  if (l.includes('listen') || l.includes('hear')) return 'listening';
  if (l.includes('think') || l.includes('analyz') || l.includes('reason') || l.includes('solv') || l.includes('ponder')) return 'solving';
  if (l.includes('compose') || l.includes('write') || l.includes('draft')) return 'composing';
  if (l.includes('shape') || l.includes('morph')) return 'shaping';
  return 'working';
}

/** Subtle agent-side activity indicator while a turn is still running. */
export function AgentTurnLoader({ label }: { label?: string }) {
  const safeLabel = label?.trim();
  const orbState: OrbState = safeLabel ? deriveOrbState(safeLabel) : 'working';
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
        state={orbState}
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
