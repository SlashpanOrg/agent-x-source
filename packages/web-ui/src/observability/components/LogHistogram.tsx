/** Stacked-by-level bar chart of log counts over time (§11.11). */
import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { ObservabilityLogEntry } from '@agentx/shared';
import { obs, obsMonoSx, LOG_LEVEL_COLORS } from '../obs-theme';

export function LogHistogram({ logs, from, to }: { logs: ObservabilityLogEntry[]; from: string; to: string }) {
  const data = useMemo(() => {
    const start = new Date(from).getTime();
    const end = new Date(to).getTime();
    const dur = end - start;
    const buckets = 30;
    const bucketDur = dur / buckets;
    const bucketsData: { time: string; debug: number; info: number; warn: number; error: number }[] = [];
    for (let i = 0; i < buckets; i++) {
      const t = start + i * bucketDur;
      bucketsData.push({ time: new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), debug: 0, info: 0, warn: 0, error: 0 });
    }
    for (const l of logs) {
      const ts = new Date(l.ts).getTime();
      const idx = Math.min(buckets - 1, Math.max(0, Math.floor((ts - start) / bucketDur)));
      const bucket = bucketsData[idx];
      if (bucket && l.level in bucket) (bucket[l.level as keyof typeof bucket])++;
    }
    return bucketsData;
  }, [logs, from, to]);

  if (logs.length === 0) return <Typography sx={{ ...obsMonoSx, fontSize: '0.62rem', color: obs.text.dim }}>No logs.</Typography>;

  return (
    <Box sx={{ height: 120 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: obs.text.dim }} />
          <YAxis tick={{ fontSize: 10, fill: obs.text.dim }} />
          <Tooltip contentStyle={{ background: obs.bg.panel, border: `1px solid ${obs.border.default}`, fontSize: 11 }} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="error" stackId="a" fill={LOG_LEVEL_COLORS.error} name="error" />
          <Bar dataKey="warn" stackId="a" fill={LOG_LEVEL_COLORS.warn} name="warn" />
          <Bar dataKey="info" stackId="a" fill={LOG_LEVEL_COLORS.info} name="info" />
          <Bar dataKey="debug" stackId="a" fill={LOG_LEVEL_COLORS.debug} name="debug" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}
