/** Dashboard panel wrapper (§11.11) — title bar + content + menu. */
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { useState, type ReactNode } from 'react';
import { obs, obsMonoSx, obsOverlineSx, obsPanelSx, obsPanelHeaderSx, obsScanlineSx } from '../obs-theme';

export function Panel({
  title,
  subtitle,
  children,
  onExportCsv,
  onRemove,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onExportCsv?: () => void;
  onRemove?: () => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  return (
    <Box sx={{ ...obsPanelSx(), height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={obsScanlineSx} />
      <Box sx={{ ...obsPanelHeaderSx, position: 'relative', zIndex: 1 }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ ...obsOverlineSx, fontSize: '0.6rem', color: obs.text.primary }}>{title}</Typography>
          {subtitle && <Typography sx={{ ...obsMonoSx, fontSize: '0.58rem', color: obs.text.dim }}>{subtitle}</Typography>}
        </Box>
        {(onExportCsv || onRemove) && (
          <>
            <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)} sx={{ color: obs.text.dim }}>
              <MoreVertIcon sx={{ fontSize: 15 }} />
            </IconButton>
            <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
              {onExportCsv && <MenuItem onClick={() => { onExportCsv(); setAnchor(null); }}>Export CSV</MenuItem>}
              {onRemove && <MenuItem onClick={() => { onRemove(); setAnchor(null); }}>Remove panel</MenuItem>}
            </Menu>
          </>
        )}
      </Box>
      <Box sx={{ position: 'relative', zIndex: 1, flex: 1, minHeight: 0, p: 1.25 }}>{children}</Box>
    </Box>
  );
}
