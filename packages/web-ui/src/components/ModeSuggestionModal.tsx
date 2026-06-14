import { useState } from 'react';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import { colors } from '../theme';

const ACTION_KEYWORDS = [
  'generate', 'create', 'build', 'write', 'fix', 'deploy', 'implement',
  'make', 'develop', 'construct', 'compose', 'draft', 'produce', 'render',
  'convert', 'transform', 'edit', 'modify', 'update', 'add', 'remove',
  'delete', 'refactor', 'restructure', 'migrate', 'install', 'configure',
  'set up', 'setup', 'compile', 'bundle', 'package', 'upload', 'download',
  'send', 'execute', 'run', 'start', 'stop', 'restart', 'launch',
  'scrape', 'crawl', 'fetch', 'push', 'pull', 'clone', 'init', 'commit',
];

const DISMISS_KEY = 'agentx_mode_suggest_dismissed';

function shouldSuggestMode(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower.length < 20) return false;
  return ACTION_KEYWORDS.some(kw => lower.includes(kw));
}

interface ModeSuggestionModalProps {
  open: boolean;
  onSwitch: () => void;
  onStay: () => void;
  onClose: () => void;
}

export default function ModeSuggestionModal({ open, onSwitch, onStay, onClose }: ModeSuggestionModalProps) {
  const [dontShow, setDontShow] = useState(false);

  const handleSwitch = () => {
    if (dontShow) localStorage.setItem(DISMISS_KEY, 'true');
    onSwitch();
  };

  const handleStay = () => {
    if (dontShow) localStorage.setItem(DISMISS_KEY, 'true');
    onStay();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth
      PaperProps={{
        sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 2 }
      }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 0.5 }}>
        <SmartToyIcon sx={{ fontSize: 20, color: colors.accent.orange }} />
        <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: colors.text.primary }}>
          Switch to Agent mode?
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ pb: 1 }}>
        <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary, lineHeight: 1.6 }}>
          This task involves actions like generating, building, or writing files.
          <strong> Agent mode</strong> gives the AI full autonomous access to execute tools — perfect for getting things done.
          <span style={{ display: 'block', marginTop: 8, opacity: 0.7 }}>
            Plan mode only generates outlines and blocks write operations.
          </span>
        </Typography>
        <FormControlLabel
          control={<Checkbox size="small" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)}
            sx={{ '&.Mui-checked': { color: colors.accent.orange } }} />}
          label={<Typography sx={{ fontSize: '0.6rem', color: colors.text.dim }}>Don't ask again</Typography>}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 2, pb: 1.5, gap: 1 }}>
        <Button size="small" onClick={handleStay}
          sx={{ fontSize: '0.65rem', color: colors.text.secondary, textTransform: 'none' }}>
          Stay in Plan
        </Button>
        <Button size="small" variant="contained" onClick={handleSwitch}
          sx={{ fontSize: '0.65rem', textTransform: 'none', bgcolor: colors.accent.orange, '&:hover': { bgcolor: colors.accent.orange + 'cc' } }}>
          Switch to Agent
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export { ACTION_KEYWORDS, DISMISS_KEY, shouldSuggestMode };