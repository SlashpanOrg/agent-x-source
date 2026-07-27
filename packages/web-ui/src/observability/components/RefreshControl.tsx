/** Auto-refresh toggle + interval selector (§11.11). */
import IconButton from '@mui/material/IconButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import Tooltip from '@mui/material/Tooltip';
import RefreshIcon from '@mui/icons-material/Refresh';
import type { RefreshInterval } from '../context';
import { obs } from '../obs-theme';

const INTERVALS: RefreshInterval[] = ['off', '5s', '10s', '30s', '1m'];

export function RefreshControl({
  interval,
  onIntervalChange,
  onRefreshNow,
}: {
  interval: RefreshInterval;
  onIntervalChange: (i: RefreshInterval) => void;
  onRefreshNow: () => void;
}) {
  return (
    <>
      <Tooltip title="Refresh now">
        <IconButton size="small" onClick={onRefreshNow} sx={{ color: obs.text.dim, '&:hover': { color: obs.accent.hud } }}>
          <RefreshIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      <ToggleButtonGroup
        size="small"
        value={interval}
        exclusive
        onChange={(_, v: RefreshInterval | null) => v && onIntervalChange(v)}
      >
        {INTERVALS.map((i) => (
          <ToggleButton key={i} value={i}>{i}</ToggleButton>
        ))}
      </ToggleButtonGroup>
    </>
  );
}
