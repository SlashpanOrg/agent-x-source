/** Time-ordered heatmap for histogram metrics (§11.7). */
import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { MetricSeries } from '@agentx/shared';
import { obs, obsMonoSx } from '../obs-theme';
import { alphaColor } from '../../theme';

export function HeatmapPanel({
  series,
  label,
}: {
  series: MetricSeries[];
  label: string;
}) {
  // Each series represents a bucket (le/bucket label); points are time-ordered.
  const { buckets, times, maxCount, grid } = useMemo(() => {
    const buckets = series.map((s) => s.labels['le'] ?? s.labels['bucket'] ?? 'unknown');
    const times = [...new Set(series.flatMap((s) => s.points.map((p) => p.ts)))].sort();
    const grid = new Map<string, Map<string, number>>(); // time -> bucket -> count
    let maxCount = 1;
    for (const s of series) {
      const bucket = s.labels['le'] ?? s.labels['bucket'] ?? 'unknown';
      for (const p of s.points) {
        if (!grid.has(p.ts)) grid.set(p.ts, new Map());
        grid.get(p.ts)!.set(bucket, p.value);
        if (p.value > maxCount) maxCount = p.value;
      }
    }
    return { buckets, times, maxCount, grid };
  }, [series]);

  if (series.length === 0) return <Typography sx={{ ...obsMonoSx, fontSize: '0.64rem', color: obs.text.dim }}>No data.</Typography>;

  function colorFor(count: number): string {
    if (count === 0) return 'transparent';
    const intensity = Math.max(0.15, count / maxCount);
    return alphaColor(obs.accent.hud, intensity);
  }

  return (
    <Box className="ax-scroll" sx={{ height: '100%' }}>
      <Typography sx={{ ...obsMonoSx, fontSize: '0.58rem', color: obs.text.dim, mb: 0.5, display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: `60px repeat(${times.length}, 1fr)`, gap: 0.5, fontSize: '0.56rem' }}>
        <Box />
        {times.map((t) => (
          <Box key={t} sx={{ ...obsMonoSx, textAlign: 'center', color: obs.text.dim }}>
            {new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Box>
        ))}
        {buckets.map((b) => (
          <Box key={b} sx={{ display: 'contents' }}>
            <Box sx={{ ...obsMonoSx, color: obs.text.dim, textAlign: 'right', pr: 0.5 }}>{b}</Box>
            {times.map((t) => {
              const count = grid.get(t)?.get(b) ?? 0;
              return (
                <Box
                  key={`${b}-${t}`}
                  sx={{ ...obsMonoSx, bgcolor: colorFor(count), border: `1px solid ${obs.border.subtle}`, height: 16, borderRadius: '3px', textAlign: 'center', color: obs.text.primary }}
                  title={`${b}: ${count}`}
                >
                  {count > 0 ? count : ''}
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
