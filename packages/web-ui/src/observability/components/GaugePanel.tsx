/** Semicircular gauge with green/amber/red zones (§11.7). */
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { obs, obsMonoSx } from '../obs-theme';

export function GaugePanel({
  value,
  min = 0,
  max = 100,
  label,
  unit,
  zones = { green: 60, amber: 80 },
  invert = false,
}: {
  value: number;
  min?: number;
  max?: number;
  label: string;
  unit?: string;
  zones?: { green: number; amber: number };
  invert?: boolean;
}) {
  const pct = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const angle = pct * 180;
  const evalPct = invert ? 1 - pct : pct;
  const color = evalPct * 100 < zones.green ? obs.accent.signal : evalPct * 100 < zones.amber ? obs.accent.amber : obs.accent.alert;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'center' }}>
      <Typography sx={{ ...obsMonoSx, fontSize: '0.58rem', color: obs.text.dim, textTransform: 'uppercase', letterSpacing: '0.6px' }}>{label}</Typography>
      <Box sx={{ position: 'relative', width: 120, height: 70 }}>
        <svg width="120" height="70" viewBox="0 0 120 70">
          {/* Background arc */}
          <path d="M 10 60 A 50 50 0 0 1 110 60" fill="none" stroke={obs.border.default} strokeWidth="8" strokeLinecap="round" />
          {/* Value arc */}
          <path
            d={`M 10 60 A 50 50 0 0 1 ${10 + 100 * Math.cos((180 - angle) * Math.PI / 180)} ${60 - 50 * Math.sin((180 - angle) * Math.PI / 180)}`}
            fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          />
        </svg>
      </Box>
      <Typography sx={{ ...obsMonoSx, fontSize: '1.1rem', fontWeight: 700, color: obs.text.primary }}>{value}{unit}</Typography>
    </Box>
  );
}
