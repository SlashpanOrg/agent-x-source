/** Span waterfall — Gantt view of the span tree (§11.5). */
import { useState, useMemo, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ErrorIcon from '@mui/icons-material/Error';
import type { SpanNode } from '@agentx/shared';
import { getSpanKindColor } from './SpanKindLegend';
import { obs, obsMonoSx } from '../obs-theme';
import { alphaColor } from '../../theme';

interface FlatSpan {
  span: SpanNode;
  depth: number;
  index: number;
  hasChildren: boolean;
}

function flatten(spans: SpanNode[], depth = 0, collapsed: Set<string>): FlatSpan[] {
  const result: FlatSpan[] = [];
  let idx = 0;
  const walk = (s: SpanNode, d: number) => {
    const hasChildren = (s.children?.length ?? 0) > 0;
    result.push({ span: s, depth: d, index: idx++, hasChildren });
    if (hasChildren && !collapsed.has(s.span_id)) {
      for (const c of s.children!) walk(c, d + 1);
    }
  };
  for (const s of spans) walk(s, depth);
  return result;
}

export function SpanWaterfall({
  spans,
  traceStart,
  traceEnd,
  selectedSpanId,
  onSelectSpan,
  findQuery,
  findMatches,
  currentMatchIdx,
  kindFilter,
  showCriticalPath,
}: {
  spans: SpanNode[];
  traceStart: number;
  traceEnd: number;
  selectedSpanId?: string;
  onSelectSpan: (span: SpanNode) => void;
  findQuery?: string;
  findMatches?: Set<string>;
  currentMatchIdx?: number;
  kindFilter?: Set<string>;
  showCriticalPath?: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const totalDur = Math.max(1, traceEnd - traceStart);
  const toX = (ts: number) => ((ts - traceStart) / totalDur) * 100;

  const flat = useMemo(() => flatten(spans, 0, collapsed), [spans, collapsed]);

  const toggleCollapse = useCallback((spanId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  }, []);

  // Time markers for the ruler.
  const markers = useMemo(() => {
    const ticks: number[] = [];
    const step = totalDur / 8;
    for (let i = 0; i <= 8; i++) ticks.push(i * step);
    return ticks;
  }, [totalDur]);

  let matchCounter = 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      {/* Timeline ruler */}
      <Box sx={{ display: 'flex', height: 20, borderBottom: `1px solid ${obs.border.default}`, position: 'relative', ml: '240px' }}>
        {markers.map((ms, i) => (
          <Box key={i} sx={{ position: 'absolute', left: `${toX(traceStart + ms)}%`, top: 0, height: '100%' }}>
            <Typography sx={{ ...obsMonoSx, fontSize: '0.56rem', color: obs.text.dim, transform: 'translateX(-50%)' }}>
              {ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`}
            </Typography>
            <Box sx={{ position: 'absolute', left: '50%', top: 14, width: '1px', height: 6, bgcolor: obs.border.default }} />
          </Box>
        ))}
      </Box>

      {/* Span rows */}
      {flat.map(({ span, depth, hasChildren }) => {
        const start = new Date(span.started_at).getTime();
        const end = span.ended_at ? new Date(span.ended_at).getTime() : start + 1;
        const dur = end - start;
        const isCollapsed = collapsed.has(span.span_id);
        const isSelected = selectedSpanId === span.span_id;
        const isError = span.status === 'error';
        const isMatch = findMatches?.has(span.span_id);
        const isCurrentMatch = isMatch && matchCounter++ === currentMatchIdx;
        const isHidden = kindFilter && kindFilter.size > 0 && !kindFilter.has(span.kind);
        const isDimmed = findQuery && !isMatch;

        if (isHidden) return null;

        return (
          <Box
            key={span.span_id}
            data-span-id={span.span_id}
            sx={{
              display: 'flex', alignItems: 'center', height: 22,
              cursor: 'pointer',
              bgcolor: isSelected ? alphaColor(obs.accent.hud, 0.14) : isCurrentMatch ? alphaColor(obs.accent.amber, 0.14) : 'transparent',
              opacity: isDimmed ? 0.3 : 1,
              '&:hover': { bgcolor: alphaColor(obs.accent.hud, 0.08) },
              borderLeft: isError ? `2px solid ${obs.accent.alert}` : '2px solid transparent',
            }}
            onClick={() => onSelectSpan(span)}
          >
            {/* Label (left, fixed width) */}
            <Box sx={{ width: 240, display: 'flex', alignItems: 'center', pl: depth * 2, flexShrink: 0, overflow: 'hidden' }}>
              {hasChildren && (
                <IconButton size="small" sx={{ p: 0, mr: 0.25, color: obs.text.dim }} onClick={(e) => { e.stopPropagation(); toggleCollapse(span.span_id); }}>
                  {isCollapsed ? <ChevronRightIcon sx={{ fontSize: 14 }} /> : <ExpandMoreIcon sx={{ fontSize: 14 }} />}
                </IconButton>
              )}
              <Box sx={{ width: 7, height: 7, borderRadius: '2px', bgcolor: getSpanKindColor(span.kind), flexShrink: 0, mr: 0.6 }} />
              <Typography sx={{ ...obsMonoSx, fontSize: '0.66rem', color: obs.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                {span.name}
              </Typography>
              {isError && <ErrorIcon sx={{ fontSize: 12, color: obs.accent.alert, ml: 0.5, flexShrink: 0 }} />}
            </Box>
            {/* Bar (right, proportional) */}
            <Box sx={{ position: 'relative', flex: 1, height: '100%' }}>
              {/* Vertical guide lines */}
              {markers.map((ms, i) => (
                <Box key={i} sx={{ position: 'absolute', left: `${toX(traceStart + ms)}%`, top: 0, width: '1px', height: '100%', bgcolor: obs.border.default, opacity: 0.5 }} />
              ))}
              <Tooltip title={`${span.name} — ${dur}ms`} placement="top">
                <Box
                  sx={{
                    position: 'absolute',
                    left: `${toX(start)}%`,
                    width: `${Math.max(0.2, toX(end) - toX(start))}%`,
                    top: 3,
                    height: 16,
                    bgcolor: getSpanKindColor(span.kind),
                    borderRadius: '3px',
                    overflow: 'hidden',
                    border: showCriticalPath && (span.attributes?.['critical_path'] === true) ? `1px solid ${obs.accent.amber}` : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    px: 0.5,
                  }}
                >
                  {dur > 50 && (
                    <Typography component="span" sx={{ ...obsMonoSx, fontSize: '0.5rem', color: '#0a0a12', whiteSpace: 'nowrap', overflow: 'hidden', fontWeight: 600 }}>
                      {String(span.attributes?.['gen_ai.request.model'] ?? span.attributes?.['tool.name'] ?? '')}
                    </Typography>
                  )}
                </Box>
              </Tooltip>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
