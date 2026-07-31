/**
 * Reusable log row (§11.11) — timestamp, level, scope, message, expandable payload.
 *
 * NOTE: payload details open in a `Dialog` rather than expanding inline. Log
 * rows are rendered inside a fixed-height `VirtualList` (absolutely positioned
 * siblings) — inline expansion would grow a row past its slot and visually
 * overlap the next row. A dialog keeps every row's height constant.
 */
import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TimelineIcon from '@mui/icons-material/Timeline';
import type { ObservabilityLogEntry } from '@agentx/shared';
import { JsonViewer } from './JsonViewer';
import { DomainBadge } from './DomainToggle';
import { obs, obsMonoSx, obsOverlineSx, LOG_LEVEL_COLORS } from '../obs-theme';
import { alphaColor } from '../../theme';

export function LogRow({
  log,
  onTraceClick,
  onSpanClick,
}: {
  log: ObservabilityLogEntry;
  onTraceClick?: (traceId: string) => void;
  onSpanClick?: (spanId: string) => void;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const levelColor = LOG_LEVEL_COLORS[log.level] ?? obs.text.dim;
  const hasDetail = !!log.payload || !!log.span_id;

  return (
    <>
      <Box
        sx={{
          py: 0.5, px: 1, borderBottom: `1px solid ${obs.border.subtle}`,
          bgcolor: (log.level === 'error' || log.level === 'warn') ? alphaColor(levelColor, 0.06) : 'transparent',
          display: 'flex', gap: 0.75, alignItems: 'center',
          cursor: hasDetail ? 'pointer' : 'default',
        }}
        onClick={() => hasDetail && setDetailOpen(true)}
      >
        {hasDetail
          ? <ChevronRightIcon sx={{ fontSize: 13, color: obs.text.dim, flexShrink: 0 }} />
          : <Box sx={{ width: 13, flexShrink: 0 }} />}
        <DomainBadge domain={log.domain} />
        <Typography sx={{ ...obsMonoSx, fontSize: '0.62rem', color: obs.text.dim, minWidth: 68, flexShrink: 0 }} title={log.ts}>
          {new Date(log.ts).toLocaleTimeString()}
        </Typography>
        <Box
          component="span"
          sx={{
            ...obsMonoSx, fontSize: '0.55rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
            color: levelColor, px: 0.5, borderRadius: '3px', border: `1px solid ${alphaColor(levelColor, 0.4)}`,
            bgcolor: alphaColor(levelColor, 0.1), flexShrink: 0,
          }}
        >
          {log.level}
        </Box>
        <Typography sx={{ ...obsMonoSx, fontSize: '0.62rem', color: obs.text.dim, flexShrink: 0 }}>{log.scope}</Typography>
        {log.trace_id && (
          <IconButton size="small" sx={{ p: 0, color: obs.text.dim }} onClick={(e) => { e.stopPropagation(); onTraceClick?.(log.trace_id!); }} title="View trace">
            <TimelineIcon sx={{ fontSize: 12 }} />
          </IconButton>
        )}
        <Typography sx={{ ...obsMonoSx, fontSize: '0.66rem', color: obs.text.primary, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {log.message}
        </Typography>
      </Box>

      <Dialog open={detailOpen} onClose={() => setDetailOpen(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { bgcolor: obs.bg.void, border: `1px solid ${obs.border.default}` } }}>
        <DialogTitle sx={{ ...obsOverlineSx, fontSize: '0.68rem', color: obs.text.primary, borderBottom: `1px solid ${obs.border.subtle}` }}>
          {log.scope} · {log.level}
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Typography sx={{ ...obsMonoSx, fontSize: '0.68rem', color: obs.text.primary, mb: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {log.message}
          </Typography>
          {log.payload && <JsonViewer data={log.payload} maxHeight={320} />}
          {log.span_id && (
            <Typography
              component="span"
              onClick={() => { setDetailOpen(false); onSpanClick?.(log.span_id!); }}
              sx={{ ...obsMonoSx, fontSize: '0.62rem', color: obs.accent.hud, cursor: 'pointer', display: 'inline-block', mt: 1.5, '&:hover': { textDecoration: 'underline' } }}
            >
              Jump to span →
            </Typography>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
