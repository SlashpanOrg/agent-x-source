/** Reusable multi-select chip filter (§11.11) — used in trace list, logs, metrics. */
import Chip from '@mui/material/Chip';
import Box from '@mui/material/Box';
import { obs, obsMonoSx } from '../obs-theme';
import { alphaColor } from '../../theme';

export function FilterChips<T extends string>({
  options,
  selected,
  onChange,
  label,
  colors,
}: {
  options: readonly T[];
  selected: T[];
  onChange: (sel: T[]) => void;
  label?: string;
  colors?: Partial<Record<T, string>>;
}) {
  const toggle = (v: T) => {
    if (selected.includes(v)) onChange(selected.filter((s) => s !== v));
    else onChange([...selected, v]);
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, flexWrap: 'wrap' }}>
      {label && (
        <Box component="span" sx={{ ...obsMonoSx, fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '1px', color: obs.text.dim, mr: 0.25 }}>
          {label}
        </Box>
      )}
      {options.map((opt) => {
        const active = selected.includes(opt);
        const accent = colors?.[opt] ?? obs.accent.hud;
        return (
          <Chip
            key={opt}
            label={opt}
            size="small"
            onClick={() => toggle(opt)}
            sx={{
              ...obsMonoSx,
              fontSize: '0.6rem',
              height: 22,
              borderRadius: '4px',
              color: active ? accent : obs.text.dim,
              bgcolor: active ? alphaColor(accent, 0.12) : 'transparent',
              border: `1px solid ${active ? alphaColor(accent, 0.4) : obs.border.default}`,
              '&:hover': { bgcolor: alphaColor(accent, 0.12), borderColor: alphaColor(accent, 0.4) },
            }}
          />
        );
      })}
    </Box>
  );
}
