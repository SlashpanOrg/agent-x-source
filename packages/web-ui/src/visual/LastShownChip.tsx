import Box from '@mui/material/Box';
import { colors, MONO, alphaColor } from '../theme';
import { useVisualStageOptional } from '../components/visual/VisualStageProvider';

export function LastShownChip() {
  const stage = useVisualStageOptional();
  const last = stage?.peekLast() ?? null;
  if (!last || !stage) return null;
  return (
    <Box
      component="button"
      type="button"
      onClick={() => stage.open(last)}
      sx={{
        all: 'unset',
        cursor: 'pointer',
        fontFamily: MONO,
        fontSize: '0.48rem',
        letterSpacing: '0.06em',
        color: colors.accent.blue,
        border: `1px solid ${alphaColor(colors.accent.blue, '40')}`,
        borderRadius: '999px',
        px: 0.7,
        py: 0.15,
        maxWidth: 160,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        '&:hover': { color: colors.text.primary, borderColor: colors.accent.blue },
      }}
      title={last.title}
    >
      Last shown
    </Box>
  );
}
