/** Small icon button that copies text to clipboard with a "Copied!" tooltip (§11.11). */
import { useState, useCallback } from 'react';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Snackbar from '@mui/material/Snackbar';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import { obs } from '../obs-theme';

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setOpen(true);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* ignore */ }
  }, [text]);

  return (
    <>
      <Tooltip title={copied ? 'Copied!' : label}>
        <IconButton size="small" onClick={copy} sx={{ color: copied ? obs.accent.signal : obs.text.dim, '&:hover': { color: obs.accent.hud } }}>
          {copied ? <CheckIcon sx={{ fontSize: 13 }} /> : <ContentCopyIcon sx={{ fontSize: 13 }} />}
        </IconButton>
      </Tooltip>
      <Snackbar
        open={open}
        autoHideDuration={1500}
        onClose={() => setOpen(false)}
        message="Copied to clipboard"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </>
  );
}
