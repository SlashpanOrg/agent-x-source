/** Stat panel — big number + sparkline + trend arrow (§11.7). */
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import type { MetricPoint } from '@agentx/shared';
import { obs, obsMonoSx } from '../obs-theme';

export function StatPanel({
  value,
  label,
  unit,
  data,
  trend,
}: {
  value: number | string;
  label: string;
  unit?: string;
  data?: MetricPoint[];
  trend?: 'up' | 'down' | 'flat';
}) {
  const chartData = (data ?? []).map((p) => ({ v: p.value, t: p.ts }));
  const trendColor = trend === 'up' ? obs.accent.signal : trend === 'down' ? obs.accent.alert : obs.text.dim;
  const trendIcon = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Typography sx={{ ...obsMonoSx, fontSize: '0.58rem', color: obs.text.dim, textTransform: 'uppercase', letterSpacing: '0.6px' }}>{label}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
        <Typography sx={{ ...obsMonoSx, fontSize: '1.5rem', fontWeight: 700, color: obs.text.primary }}>{value}</Typography>
        {unit && <Typography sx={{ ...obsMonoSx, fontSize: '0.65rem', color: obs.text.dim }}>{unit}</Typography>}
        {trend && <Typography sx={{ ...obsMonoSx, fontSize: '0.7rem', color: trendColor }}>{trendIcon}</Typography>}
      </Box>
      {chartData.length > 0 && (
        <Box sx={{ flex: 1, minHeight: 30 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Line type="monotone" dataKey="v" stroke={obs.accent.hud} strokeWidth={1.25} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      )}
    </Box>
  );
}
