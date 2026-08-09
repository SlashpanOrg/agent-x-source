import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import { colors, alphaColor } from '../theme';

export interface ConfirmDeleteDialogProps {
  open: boolean;
  busy?: boolean;
  title: string;
  /** Short label shown above the title (HUD style). */
  warningLabel?: string;
  /** Item name highlighted in the body. */
  itemName?: string;
  description: string;
  confirmLabel?: string;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmDeleteDialog({
  open,
  busy = false,
  title,
  warningLabel = 'Warning',
  itemName,
  description,
  confirmLabel = 'Delete',
  error,
  onClose,
  onConfirm,
}: ConfirmDeleteDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={() => { if (!busy) onClose(); }}
      PaperProps={{
        sx: {
          bgcolor: colors.bg.secondary,
          border: `1px solid ${alphaColor(colors.accent.red, '35')}`,
          borderRadius: 1,
          maxWidth: 420,
          width: '90%',
        },
      }}
    >
      <DialogTitle
        sx={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.48rem',
          letterSpacing: '2px',
          textTransform: 'uppercase',
          color: colors.accent.red,
          pb: 0,
          pt: 2,
        }}
      >
        {warningLabel}
      </DialogTitle>
      <DialogTitle
        sx={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.82rem',
          fontWeight: 700,
          letterSpacing: '1px',
          pt: 0.5,
          color: colors.text.primary,
        }}
      >
        {title}
      </DialogTitle>
      <DialogContent sx={{ pt: '8px !important' }}>
        <Typography sx={{ color: colors.text.secondary, fontSize: '0.72rem', lineHeight: 1.65 }}>
          {itemName ? (
            <>
              {description}
              {' '}
              <Box component="span" sx={{ color: colors.text.primary, fontWeight: 600 }}>
                {itemName}
              </Box>.
            </>
          ) : (
            description
          )}
          {' '}
          This cannot be undone.
        </Typography>
        {error && (
          <Typography sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', color: colors.accent.red, mt: 1 }}>
            {error}
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 2.5, pb: 2, gap: 1 }}>
        <Button
          onClick={onClose}
          disabled={busy}
          size="small"
          sx={{ color: colors.text.dim, textTransform: 'none', fontSize: '0.65rem', fontFamily: "'JetBrains Mono', monospace" }}
        >
          Cancel
        </Button>
        <Button
          onClick={onConfirm}
          disabled={busy}
          size="small"
          startIcon={busy ? <CircularProgress size={12} sx={{ color: colors.bg.primary }} /> : undefined}
          sx={{
            color: colors.bg.primary,
            bgcolor: colors.accent.red,
            textTransform: 'none',
            fontSize: '0.65rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 700,
            '&:hover': { bgcolor: alphaColor(colors.accent.red, '0.85') },
            '&.Mui-disabled': { opacity: 0.55 },
          }}
        >
          {busy ? 'Deleting…' : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
