/** Metrics panel — token/cost/latency charts for a trace (§11.5). */
import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Grid from '@mui/material/Grid';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { SpanNode } from '@agentx/shared';
import { obs, obsMonoSx, obsOverlineSx } from '../obs-theme';

export function MetricsPanel({ spans }: { spans: SpanNode[] }) {
  const stats = useMemo(() => {
    let inputTokens = 0, outputTokens = 0, costUsd = 0;
    const toolLatency: { name: string; ms: number }[] = [];
    for (const s of spans) {
      const a = s.attributes ?? {};
      inputTokens += (a['gen_ai.usage.input_tokens'] as number) ?? 0;
      outputTokens += (a['gen_ai.usage.output_tokens'] as number) ?? 0;
      costUsd += (a['gen_ai.cost.usd'] as number) ?? 0;
      if (s.kind === 'tool' && s.duration_ms != null) {
        toolLatency.push({ name: (a['tool.name'] as string) ?? s.name, ms: s.duration_ms });
      }
    }
    return { inputTokens, outputTokens, costUsd, toolLatency };
  }, [spans]);

  const tokenData = [{ name: 'Tokens', input: stats.inputTokens, output: stats.outputTokens }];

  return (
    <Accordion sx={{ '&.Mui-expanded': { margin: 0 } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: obs.text.dim }} />}>
        <Typography sx={{ ...obsOverlineSx, fontSize: '0.66rem', color: obs.text.primary }}>Metrics</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Grid container spacing={2}>
          <Grid item xs={6}>
            <Typography sx={{ ...obsMonoSx, fontSize: '0.58rem', color: obs.text.dim, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tokens</Typography>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={tokenData}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: obs.text.dim }} />
                <YAxis tick={{ fontSize: 10, fill: obs.text.dim }} />
                <Tooltip contentStyle={{ background: obs.bg.panel, border: `1px solid ${obs.border.default}`, fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="input" fill={obs.accent.hud} name="Input" radius={[3, 3, 0, 0]} />
                <Bar dataKey="output" fill={obs.accent.signal} name="Output" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Grid>
          <Grid item xs={6}>
            <Typography sx={{ ...obsMonoSx, fontSize: '0.58rem', color: obs.text.dim, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Cost: ${stats.costUsd.toFixed(4)}
            </Typography>
            <Box sx={{ mt: 1 }}>
              <Typography sx={{ ...obsMonoSx, fontSize: '0.58rem', color: obs.text.dim, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tool Latency</Typography>
              {stats.toolLatency.length > 0 ? (
                <ResponsiveContainer width="100%" height={120}>
                  <BarChart data={stats.toolLatency}>
                    <XAxis dataKey="name" tick={{ fontSize: 9, fill: obs.text.dim }} />
                    <YAxis tick={{ fontSize: 10, fill: obs.text.dim }} />
                    <Tooltip contentStyle={{ background: obs.bg.panel, border: `1px solid ${obs.border.default}`, fontSize: 11 }} />
                    <Bar dataKey="ms" fill={obs.accent.amber} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Typography sx={{ ...obsMonoSx, fontSize: '0.64rem', color: obs.text.dim }}>No tool calls.</Typography>
              )}
            </Box>
          </Grid>
        </Grid>
      </AccordionDetails>
    </Accordion>
  );
}
