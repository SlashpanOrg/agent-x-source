/** Global time range picker (§11.11) — 5m/15m/1h/6h/24h/7d/custom. */
import { useState } from 'react';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import TextField from '@mui/material/TextField';
import Box from '@mui/material/Box';
import type { TimeRangePreset, TimeRange } from '../context';
import { obsInputSx } from '../obs-theme';

const PRESETS: TimeRangePreset[] = ['5m', '15m', '1h', '6h', '24h', '7d', 'custom'];

export function TimeRangeSelector({ value, onChange }: { value: TimeRange; onChange: (tr: TimeRange) => void }) {
  const [customFrom, setCustomFrom] = useState(value.preset === 'custom' ? value.from.slice(0, 16) : '');
  const [customTo, setCustomTo] = useState(value.preset === 'custom' ? value.to.slice(0, 16) : '');

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
      <ToggleButtonGroup
        size="small"
        value={value.preset}
        exclusive
        onChange={(_, v: TimeRangePreset | null) => {
          if (!v) return;
          if (v === 'custom') {
            onChange({ preset: 'custom', from: customFrom ? new Date(customFrom).toISOString() : new Date(Date.now() - 3600000).toISOString(), to: customTo ? new Date(customTo).toISOString() : new Date().toISOString() });
          } else {
            const now = Date.now();
            const ms = { '5m': 300000, '15m': 900000, '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000 }[v];
            onChange({ preset: v, from: new Date(now - ms).toISOString(), to: new Date(now).toISOString() });
          }
        }}
      >
        {PRESETS.map((p) => (
          <ToggleButton key={p} value={p}>{p}</ToggleButton>
        ))}
      </ToggleButtonGroup>
      {value.preset === 'custom' && (
        <Box sx={{ display: 'flex', gap: 0.75 }}>
          <TextField type="datetime-local" size="small" value={customFrom} onChange={(e) => { setCustomFrom(e.target.value); onChange({ preset: 'custom', from: new Date(e.target.value).toISOString(), to: customTo ? new Date(customTo).toISOString() : new Date().toISOString() }); }} sx={{ width: 172, ...obsInputSx }} />
          <TextField type="datetime-local" size="small" value={customTo} onChange={(e) => { setCustomTo(e.target.value); onChange({ preset: 'custom', from: customFrom ? new Date(customFrom).toISOString() : new Date().toISOString(), to: new Date(e.target.value).toISOString() }); }} sx={{ width: 172, ...obsInputSx }} />
        </Box>
      )}
    </Box>
  );
}
