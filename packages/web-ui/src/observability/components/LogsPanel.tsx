/** Logs panel — below the waterfall in trace detail (§11.5). */
import { useState, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { ObservabilityLogEntry } from '@agentx/shared';
import { FilterChips } from './FilterChips';
import { JsonViewer } from './JsonViewer';
import { obs, obsMonoSx, obsOverlineSx, obsInputSx, LOG_LEVEL_COLORS } from '../obs-theme';
import { alphaColor } from '../../theme';

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export function LogsPanel({
  logs,
  traceStart,
  onLogClick,
}: {
  logs: ObservabilityLogEntry[];
  traceStart: number;
  onLogClick?: (log: ObservabilityLogEntry) => void;
}) {
  const [levelFilter, setLevelFilter] = useState<string[]>([]);
  const [scopeFilter, setScopeFilter] = useState<string>('');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (levelFilter.length > 0 && !levelFilter.includes(l.level)) return false;
      if (scopeFilter && l.scope !== scopeFilter) return false;
      if (query && !l.message.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [logs, levelFilter, scopeFilter, query]);

  return (
    <Accordion defaultExpanded sx={{ '&.Mui-expanded': { margin: 0 } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: obs.text.dim }} />}>
        <Typography sx={{ ...obsOverlineSx, fontSize: '0.66rem', color: obs.text.primary }}>Logs ({filtered.length})</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
          <FilterChips options={LEVELS} selected={levelFilter} onChange={setLevelFilter} label="Level" colors={LOG_LEVEL_COLORS} />
          <TextField
            size="small" placeholder="Scope" value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value)} sx={{ width: 120, ...obsInputSx }}
          />
          <TextField
            size="small" placeholder="Search logs…" value={query}
            onChange={(e) => setQuery(e.target.value)} sx={{ width: 150, ...obsInputSx }}
          />
        </Box>
        <Box className="ax-scroll" sx={{ maxHeight: 300 }}>
          {filtered.length === 0 ? (
            <Typography sx={{ ...obsMonoSx, fontSize: '0.66rem', color: obs.text.dim, py: 2, textAlign: 'center', display: 'block' }}>No logs found.</Typography>
          ) : (
            filtered.map((l, i) => {
              const relMs = new Date(l.ts).getTime() - traceStart;
              const color = LOG_LEVEL_COLORS[l.level] ?? obs.text.dim;
              return (
                <Box
                  key={i}
                  sx={{
                    py: 0.5, px: 1, cursor: onLogClick ? 'pointer' : 'default',
                    '&:hover': { bgcolor: obs.bg.hud },
                    borderBottom: `1px solid ${obs.border.subtle}`,
                    bgcolor: (l.level === 'error' || l.level === 'warn') ? alphaColor(color, 0.06) : 'transparent',
                  }}
                  onClick={() => onLogClick?.(l)}
                >
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Typography sx={{ ...obsMonoSx, fontSize: '0.6rem', color: obs.text.dim, minWidth: 56 }}>
                      +{(relMs / 1000).toFixed(2)}s
                    </Typography>
                    <Box component="span" sx={{ ...obsMonoSx, fontSize: '0.55rem', fontWeight: 700, textTransform: 'uppercase', color, px: 0.5, borderRadius: '3px', border: `1px solid ${alphaColor(color, 0.4)}`, bgcolor: alphaColor(color, 0.1) }}>
                      {l.level}
                    </Box>
                    <Typography sx={{ ...obsMonoSx, fontSize: '0.6rem', color: obs.text.dim }}>{l.scope}</Typography>
                  </Box>
                  <Typography sx={{ ...obsMonoSx, fontSize: '0.64rem', color: obs.text.primary, display: 'block', whiteSpace: 'pre-wrap', wordBreak: 'break-word', mt: 0.15 }}>
                    {l.message}
                  </Typography>
                  {l.payload && (
                    <Box sx={{ mt: 0.5 }}>
                      {expanded === `${i}` ? (
                        <JsonViewer data={l.payload} maxHeight={200} />
                      ) : (
                        <Typography
                          sx={{ ...obsMonoSx, fontSize: '0.6rem', color: obs.accent.hud, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                          onClick={(e) => { e.stopPropagation(); setExpanded(`${i}`); }}
                        >
                          Show payload
                        </Typography>
                      )}
                    </Box>
                  )}
                </Box>
              );
            })
          )}
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}
