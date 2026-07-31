/** Color → kind legend, two rows (AGENT + APP), domain-aware (§11.11). */
import Box from '@mui/material/Box';
import type { DomainFilter } from '../context';
import { obs, obsMonoSx } from '../obs-theme';
import { alphaColor } from '../../theme';

export const SPAN_KIND_COLORS: Record<string, string> = {
  // AGENT
  llm: '#5aa9ff',
  tool: '#4ade80',
  tool_decision: '#2dd4bf',
  journey_stage: '#c4b5fd',
  agent: '#fbbf24',
  retrieval: '#67e8f9',
  internal: '#8b90a0',
  // APP
  http: '#818cf8',
  ws: '#fb923c',
  auth: '#f472b6',
  db: '#d4a373',
  channel: '#38bdf8',
  automation: '#a3e635',
  integration: '#facc15',
  job: '#a78bfa',
  // internal (shared color)
};

const AGENT_KINDS = ['llm', 'tool', 'tool_decision', 'journey_stage', 'agent', 'retrieval', 'internal'];
const APP_KINDS = ['http', 'ws', 'auth', 'db', 'channel', 'automation', 'integration', 'job', 'internal'];

export function SpanKindLegend({ domain }: { domain: DomainFilter }) {
  const rows: { label: string; kinds: string[] }[] = [];
  if (domain === 'agent' || domain === 'both') rows.push({ label: 'AGENT', kinds: AGENT_KINDS });
  if (domain === 'app' || domain === 'both') rows.push({ label: 'APP', kinds: APP_KINDS });

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, py: 0.25 }}>
      {rows.map((row) => (
        <Box key={row.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.6, flexWrap: 'wrap' }}>
          <Box component="span" sx={{ ...obsMonoSx, fontSize: '0.56rem', fontWeight: 700, letterSpacing: '1px', color: obs.text.dim, width: 42, flexShrink: 0 }}>
            {row.label}
          </Box>
          {row.kinds.map((k) => {
            const color = SPAN_KIND_COLORS[k] ?? obs.text.dim;
            return (
              <Box
                key={k}
                component="span"
                sx={{
                  ...obsMonoSx,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.4,
                  fontSize: '0.56rem',
                  height: 18,
                  px: 0.6,
                  borderRadius: '3px',
                  color,
                  bgcolor: alphaColor(color, 0.12),
                  border: `1px solid ${alphaColor(color, 0.3)}`,
                  whiteSpace: 'nowrap',
                }}
              >
                {k}
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

export function getSpanKindColor(kind: string): string {
  return SPAN_KIND_COLORS[kind] ?? '#757575';
}
