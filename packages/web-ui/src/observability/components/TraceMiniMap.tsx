/** Compressed trace overview with draggable viewport (§11.5). */
import { useRef, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import type { SpanNode } from '@agentx/shared';
import { getSpanKindColor } from './SpanKindLegend';
import { obs } from '../obs-theme';
import { alphaColor } from '../../theme';

export function TraceMiniMap({
  spans,
  traceStart,
  traceEnd,
  viewport,
  onViewportChange,
  height = 30,
}: {
  spans: SpanNode[];
  traceStart: number;
  traceEnd: number;
  viewport: { start: number; end: number };
  onViewportChange: (v: { start: number; end: number }) => void;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const totalDur = Math.max(1, traceEnd - traceStart);

  const toX = useCallback((ts: number) => ((ts - traceStart) / totalDur) * 100, [traceStart, totalDur]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!ref.current) return;
    setDragging(true);
    const rect = ref.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * totalDur + traceStart;
    const vpDur = viewport.end - viewport.start;
    onViewportChange({ start: x - vpDur / 2, end: x + vpDur / 2 });
  };

  return (
    <Box
      ref={ref}
      sx={{ position: 'relative', height, bgcolor: obs.bg.void, borderRadius: '5px', cursor: 'pointer', overflow: 'hidden', border: `1px solid ${obs.border.default}` }}
      onMouseDown={handleMouseDown}
      onMouseMove={(e) => {
        if (!dragging || !ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * totalDur + traceStart;
        const vpDur = viewport.end - viewport.start;
        onViewportChange({ start: Math.max(traceStart, x - vpDur / 2), end: Math.min(traceEnd, x + vpDur / 2) });
      }}
      onMouseUp={() => setDragging(false)}
      onMouseLeave={() => setDragging(false)}
    >
      {spans.map((s, i) => {
        const start = new Date(s.started_at).getTime();
        const end = s.ended_at ? new Date(s.ended_at).getTime() : start;
        return (
          <Box
            key={i}
            sx={{
              position: 'absolute',
              left: `${toX(start)}%`,
              width: `${Math.max(0.5, toX(end) - toX(start))}%`,
              top: 2,
              height: height - 4,
              bgcolor: getSpanKindColor(s.kind),
              opacity: 0.7,
              borderRadius: 0.5,
            }}
          />
        );
      })}
      {/* Viewport rectangle */}
      <Box
        sx={{
          position: 'absolute',
          left: `${toX(viewport.start)}%`,
          width: `${toX(viewport.end) - toX(viewport.start)}%`,
          top: 0,
          height: '100%',
          border: `2px solid ${obs.accent.hud}`,
          bgcolor: alphaColor(obs.accent.hud, 0.15),
          cursor: 'move',
        }}
      />
    </Box>
  );
}
