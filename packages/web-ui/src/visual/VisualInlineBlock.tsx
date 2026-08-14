import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { VisualItem } from '@agentx/shared/browser';
import { colors, MONO } from '../theme';
import { VisualBody } from './VisualBody';

export function VisualInlineBlock({ item }: { item: VisualItem }) {
  return (
    <Box
      sx={{
        my: 0.75,
        border: `1px solid ${colors.border.default}`,
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: colors.bg.secondary,
      }}
    >
      <Box sx={{ px: 1.25, py: 0.7, borderBottom: `1px solid ${colors.border.subtle}` }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: colors.text.primary }}>
          {item.title}
        </Typography>
        {(item.attribution || item.caption) && (
          <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: colors.text.dim, mt: 0.2 }}>
            {[item.attribution, item.caption].filter(Boolean).join(' · ')}
          </Typography>
        )}
      </Box>
      <Box sx={{ p: 1 }}>
        <VisualBody item={item} compact />
      </Box>
    </Box>
  );
}
