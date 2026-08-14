import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { VisualItem } from '@agentx/shared/browser';
import { colors, MONO, alphaColor } from '../theme';
import { openExternalUrl } from '../utils/open-external-url';
import { VisualBody } from './VisualBody';

export function VisualStageModal({
  open,
  item,
  onClose,
}: {
  open: boolean;
  item: VisualItem | null;
  onClose: () => void;
}) {
  if (!item) return null;
  const pageUrl = item.kind === 'url' && 'url' in item.source ? item.source.url : undefined;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={pageUrl ? 'lg' : 'md'}
      fullWidth
      scroll="paper"
      disableEnforceFocus
      sx={{ zIndex: 1500 }}
      slotProps={{
        backdrop: {
          sx: {
            backgroundColor: alphaColor(colors.bg.primary, 0.72),
            backdropFilter: 'blur(2px)',
          },
        },
      }}
      PaperProps={{
        elevation: 10,
        sx: {
          bgcolor: colors.bg.secondary,
          color: colors.text.primary,
          border: `1px solid ${colors.border.strong}`,
          borderRadius: 1.5,
          boxShadow: `0 16px 48px ${colors.shadow.heavy}`,
          maxHeight: '88vh',
          overflow: 'hidden',
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          borderBottom: `1px solid ${colors.border.default}`,
          bgcolor: colors.bg.elevated,
          py: 1.25,
          px: 2,
        }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            sx={{
              fontSize: '0.82rem',
              fontWeight: 700,
              color: colors.text.primary,
              fontFamily: MONO,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={item.title}
          >
            {item.title}
          </Typography>
          {(item.attribution || item.caption) && (
            <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, fontFamily: MONO, mt: 0.25 }}>
              {[item.attribution, item.caption].filter(Boolean).join(' · ')}
            </Typography>
          )}
        </Box>
        {pageUrl && (
          <IconButton
            size="small"
            onClick={() => openExternalUrl(pageUrl)}
            aria-label="Open in browser"
            title="Open in browser"
            sx={{ color: colors.text.dim, '&:hover': { color: colors.accent.blue } }}
          >
            <OpenInNewIcon sx={{ fontSize: 16 }} />
          </IconButton>
        )}
        <IconButton
          size="small"
          onClick={onClose}
          aria-label="Close"
          sx={{ color: colors.text.dim, '&:hover': { color: colors.text.primary } }}
        >
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ px: pageUrl ? 0 : 2, py: pageUrl ? 0 : 2, bgcolor: colors.bg.secondary }}>
        <VisualBody item={item} embedUrl />
      </DialogContent>
    </Dialog>
  );
}
