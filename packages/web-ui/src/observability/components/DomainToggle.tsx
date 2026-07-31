/** 3-segment Agent/App/Both domain toggle with optional count chips (§11.11). */
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import Box from '@mui/material/Box';
import type { DomainFilter } from '../context';
import { obs, obsMonoSx } from '../obs-theme';

export function DomainToggle({
  value,
  onChange,
  counts,
}: {
  value: DomainFilter;
  onChange: (d: DomainFilter) => void;
  counts?: { agent?: number; app?: number; both?: number };
}) {
  return (
    <ToggleButtonGroup
      size="small"
      value={value}
      exclusive
      onChange={(_, v: DomainFilter | null) => v && onChange(v)}
    >
      <ToggleButton value="agent">
        Agent{counts?.agent != null ? ` (${counts.agent})` : ''}
      </ToggleButton>
      <ToggleButton value="app">
        App{counts?.app != null ? ` (${counts.app})` : ''}
      </ToggleButton>
      <ToggleButton value="both">
        Both{counts?.both != null ? ` (${counts.both})` : ''}
      </ToggleButton>
    </ToggleButtonGroup>
  );
}

/** Small domain badge for table rows (AGENT=purple, APP=cyan). */
export function DomainBadge({ domain }: { domain: string }) {
  const color = domain === 'AGENT' ? obs.accent.purple : domain === 'APP' ? obs.accent.cyan : obs.text.dim;
  return (
    <Box
      component="span"
      sx={{
        ...obsMonoSx,
        display: 'inline-block',
        fontSize: '0.5rem',
        fontWeight: 700,
        letterSpacing: '0.6px',
        color,
        px: 0.6,
        py: 0.1,
        border: `1px solid ${color}`,
        borderRadius: '3px',
        lineHeight: 1.5,
        whiteSpace: 'nowrap',
      }}
    >
      {domain}
    </Box>
  );
}
