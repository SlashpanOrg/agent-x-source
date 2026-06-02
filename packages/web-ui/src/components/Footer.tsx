import Box from '@mui/material/Box';
import { colors } from '../theme';

export function Footer() {
  return (
    <Box sx={{
      flexShrink: 0, borderTop: `1px solid ${colors.border.default}`,
      px: 3, py: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontFamily: "'JetBrains Mono', monospace", fontSize: '0.5rem', color: colors.text.dim,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <span>Made in India 🇮🇳</span>
        <span style={{ color: colors.border.default }}>/</span>
        <span>Powered by Slashpan Technologies Pvt Ltd</span>
        <span style={{ color: colors.border.default }}>/</span>
        <span>
          Created by Sivaprakash Rajendran (
          <a href="mailto:sr@slashpan.com" style={{ color: colors.accent.blue, textDecoration: 'none' }}>sr@slashpan.com</a>
          )
        </span>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <span>Free to Use</span>
      </Box>
    </Box>
  );
}
