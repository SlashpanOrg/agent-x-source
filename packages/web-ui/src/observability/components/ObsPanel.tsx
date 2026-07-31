/** Shared HUD panel/card + page header primitives used across observability pages. */
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { obs, obsMonoSx, obsOverlineSx, obsPanelSx, obsPanelHeaderSx, obsPanelBodySx, obsScanlineSx } from '../obs-theme';

export function ObsPanel({
  title,
  subtitle,
  icon,
  accent,
  action,
  noBodyPadding,
  children,
}: {
  title?: string;
  subtitle?: string;
  icon?: ReactNode;
  accent?: string;
  action?: ReactNode;
  noBodyPadding?: boolean;
  children: ReactNode;
}) {
  return (
    <Box sx={obsPanelSx(accent)}>
      <Box sx={obsScanlineSx} />
      <Box sx={{ position: 'relative', zIndex: 1 }}>
        {(title || action) && (
          <Box sx={obsPanelHeaderSx}>
            {icon && <Box sx={{ color: accent ?? obs.accent.hud, display: 'flex', flexShrink: 0 }}>{icon}</Box>}
            <Box sx={{ minWidth: 0, flex: 1 }}>
              {title && <Typography sx={{ ...obsOverlineSx, fontSize: '0.64rem', color: obs.text.primary }}>{title}</Typography>}
              {subtitle && <Typography sx={{ ...obsMonoSx, fontSize: '0.6rem', color: obs.text.dim }}>{subtitle}</Typography>}
            </Box>
            {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
          </Box>
        )}
        <Box sx={noBodyPadding ? undefined : obsPanelBodySx}>{children}</Box>
      </Box>
    </Box>
  );
}

/** Compact page-level title strip (no card chrome) — icon + mono uppercase title + optional action. */
export function ObsPageHeader({
  icon, title, subtitle, action,
}: { icon?: ReactNode; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
      {icon && <Box sx={{ color: obs.accent.hud, display: 'flex' }}>{icon}</Box>}
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ ...obsOverlineSx, fontSize: '0.74rem', color: obs.text.primary, letterSpacing: '2.5px' }}>{title}</Typography>
        {subtitle && <Typography sx={{ ...obsMonoSx, fontSize: '0.62rem', color: obs.text.dim, mt: 0.1 }}>{subtitle}</Typography>}
      </Box>
      <Box sx={{ flexGrow: 1 }} />
      {action}
    </Box>
  );
}
