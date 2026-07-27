/** Colored HUD badge for trace/span status (§11.11). */
import Box from '@mui/material/Box';
import { obsBadgeSx } from '../obs-theme';

const STATE_MAP: Record<string, 'ok' | 'error' | 'running' | 'warn' | 'idle'> = {
  ok: 'ok',
  error: 'error',
  running: 'running',
  cancelled: 'idle',
  unset: 'idle',
};

export function StatusBadge({ status }: { status: string; size?: 'small' | 'medium' }) {
  const state = STATE_MAP[status] ?? 'idle';
  return <Box component="span" sx={obsBadgeSx(state)}>{status}</Box>;
}
