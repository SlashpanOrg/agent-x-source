import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import { coerceDisplayLabel } from '../../chat/utils';
import { colors, alphaColor, getActiveScheme } from '../../theme';
import { ThinkingOrb } from 'thinking-orbs';

function LoadingStepsIndicator({ steps }: { steps: Array<{ id: string; label: string; status: string }> }) {
  const label = coerceDisplayLabel(steps[0]?.label, 'Working...');
  return (
    <Typography sx={{
      fontSize: '0.75rem',
      fontWeight: 500,
      background: `linear-gradient(90deg, ${colors.text.dim} 0%, ${colors.text.primary} 50%, ${colors.text.dim} 100%)`,
      backgroundSize: '200% 100%',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      animation: 'agentx-shimmer 2s infinite linear',
    }}>
      {label}
    </Typography>
  );
}

export function ThinkingIndicator({ label }: { label?: string }) {
  const safeLabel = label ? coerceDisplayLabel(label, '') : '';
  return (
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', mb: 2, animation: 'agentx-fadeIn 0.3s ease-out' }}>
      <Box sx={{
        width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        bgcolor: alphaColor(colors.accent.purple, '15'), mt: 0.5, flexShrink: 0,
      }}>
        <SmartToyIcon sx={{ fontSize: 15, color: colors.accent.purple }} />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1.5 }}>
        {safeLabel ? (
          <LoadingStepsIndicator steps={[{ id: '', label: safeLabel, status: 'running' }]} />
        ) : (
          <>
            <ThinkingOrb
              state='working'
              size={20}
              theme={getActiveScheme() === 'dark' ? 'dark' : 'light'}
              aria-label='Thinking…'
              style={{ flexShrink: 0 }}
            />
            <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, fontStyle: 'italic' }}>Thinking...</Typography>
          </>
        )}
      </Box>
    </Box>
  );
}
