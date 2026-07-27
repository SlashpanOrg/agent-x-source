/**
 * Turn replay component (v1.1+) — reconstructs a turn from the trace's spans
 * and logs, then plays it back step-by-step with a timeline scrubber.
 *
 * Each "step" is a span (or a group of child spans) with its attributes,
 * logs, and duration. The user can play/pause/step through the timeline.
 */
import { useState, useMemo, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Slider from '@mui/material/Slider';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import type { SpanNode, ObservabilityLogEntry } from '@agentx/shared';
import { StatusBadge } from './StatusBadge';
import { ObsPanel } from './ObsPanel';
import { obs, obsMonoSx, LOG_LEVEL_COLORS } from '../obs-theme';
import { alphaColor } from '../../theme';

interface TurnReplayProps {
  spans: SpanNode[];
  logs: ObservabilityLogEntry[];
  traceStart: number;
  traceEnd: number;
  onClose: () => void;
}

interface ReplayStep {
  span: SpanNode;
  startMs: number;
  endMs: number;
  logs: ObservabilityLogEntry[];
  label: string;
  kind: string;
}

export function TurnReplay({ spans, logs, traceStart, traceEnd, onClose }: TurnReplayProps) {
  const allSpans = useMemo(() => {
    const result: SpanNode[] = [];
    const walk = (s: SpanNode) => { result.push(s); s.children?.forEach(walk); };
    spans.forEach(walk);
    return result;
  }, [spans]);

  const steps = useMemo<ReplayStep[]>(() => {
    return allSpans
      .map((span) => {
        const start = span.started_at ? new Date(span.started_at).getTime() - traceStart : 0;
        const end = span.ended_at ? new Date(span.ended_at).getTime() - traceStart : start;
        const spanLogs = logs.filter((l) => l.span_id === span.span_id);
        return { span, startMs: start, endMs: end, logs: spanLogs, label: span.name, kind: span.kind };
      })
      .sort((a, b) => a.startMs - b.startMs);
  }, [allSpans, logs, traceStart]);

  const [currentStep, setCurrentStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const totalDuration = traceEnd - traceStart || 1;

  const goToStep = useCallback((idx: number) => {
    setCurrentStep(Math.max(0, Math.min(idx, steps.length - 1)));
    const step = steps[idx];
    if (step) setProgress((step.startMs / totalDuration) * 100);
  }, [steps, totalDuration]);

  // Auto-play: advance through steps at a fixed rate.
  useEffect(() => {
    if (!playing || steps.length === 0) return;
    const timer = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev >= steps.length - 1) {
          setPlaying(false);
          setProgress(100);
          return prev;
        }
        const next = prev + 1;
        const step = steps[next];
        if (step) setProgress((step.startMs / totalDuration) * 100);
        return next;
      });
    }, 1500);
    return () => clearInterval(timer);
  }, [playing, steps, totalDuration]);

  const step = steps[currentStep];

  return (
    <ObsPanel title="Turn Replay" action={<Button size="small" onClick={onClose} sx={{ ...obsMonoSx, fontSize: '0.6rem', color: obs.text.dim, textTransform: 'uppercase' }}>Close</Button>}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {/* Timeline scrubber */}
        <Slider
          value={progress}
          min={0} max={100} step={0.1}
          valueLabelDisplay="off"
          onChange={(_, v) => {
            const ms = (v as number / 100) * totalDuration;
            setProgress(v as number);
            // Find the step closest to this time.
            const idx = steps.findIndex((s) => s.startMs <= ms && s.endMs >= ms);
            if (idx >= 0) setCurrentStep(idx);
          }}
          sx={{ color: obs.accent.hud }}
        />

        {/* Playback controls */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'center' }}>
          <IconButton size="small" onClick={() => goToStep(0)} disabled={currentStep === 0} sx={{ color: obs.text.dim }}>
            <SkipPreviousIcon sx={{ fontSize: 18 }} />
          </IconButton>
          <IconButton size="small" onClick={() => setPlaying(!playing)} sx={{ color: obs.accent.hud }}>
            {playing ? <PauseIcon sx={{ fontSize: 18 }} /> : <PlayArrowIcon sx={{ fontSize: 18 }} />}
          </IconButton>
          <IconButton size="small" onClick={() => goToStep(currentStep + 1)} disabled={currentStep >= steps.length - 1} sx={{ color: obs.text.dim }}>
            <SkipNextIcon sx={{ fontSize: 18 }} />
          </IconButton>
          <Typography sx={{ ...obsMonoSx, fontSize: '0.62rem', color: obs.text.dim }}>
            Step {currentStep + 1} / {steps.length}
          </Typography>
        </Box>

        {/* Current step detail */}
        {step && (
          <Collapse in={!!step}>
            <Box sx={{ p: 1.25, display: 'flex', flexDirection: 'column', gap: 1, border: `1px solid ${obs.border.subtle}`, borderRadius: '6px', bgcolor: obs.bg.void }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                <Typography sx={{ ...obsMonoSx, fontSize: '0.68rem', fontWeight: 700, color: obs.text.primary }}>{step.label}</Typography>
                <MiniTag label={step.kind} />
                <StatusBadge status={step.span.status} />
                <Box sx={{ flexGrow: 1 }} />
                <Typography sx={{ ...obsMonoSx, fontSize: '0.6rem', color: obs.text.dim }}>
                  {Math.round(step.endMs - step.startMs)}ms
                </Typography>
              </Box>

              {/* Key attributes */}
              {step.span.attributes && Object.keys(step.span.attributes).length > 0 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {Object.entries(step.span.attributes).slice(0, 8).map(([k, v]) => (
                    <MiniTag key={k} label={`${k}: ${String(v).slice(0, 40)}`} />
                  ))}
                </Box>
              )}

              {/* Logs for this step */}
              {step.logs.length > 0 && (
                <Box className="ax-scroll-y" sx={{ maxHeight: 120, ...obsMonoSx, fontSize: '0.62rem', color: obs.text.secondary }}>
                  {step.logs.map((l, i) => {
                    const color = LOG_LEVEL_COLORS[l.level] ?? obs.text.dim;
                    return (
                      <Box key={i} sx={{ py: 0.25, display: 'flex', gap: 0.5, alignItems: 'flex-start' }}>
                        <Box component="span" sx={{ ...obsMonoSx, fontSize: '0.52rem', fontWeight: 700, textTransform: 'uppercase', color, px: 0.4, borderRadius: '2px', border: `1px solid ${alphaColor(color, 0.4)}`, flexShrink: 0, mt: 0.1 }}>
                          {l.level}
                        </Box>
                        <Box component="span">{l.message}</Box>
                      </Box>
                    );
                  })}
                </Box>
              )}
            </Box>
          </Collapse>
        )}
      </Box>
    </ObsPanel>
  );
}

function MiniTag({ label }: { label: string }) {
  return (
    <Box
      component="span"
      sx={{
        ...obsMonoSx, fontSize: '0.56rem', px: 0.5, py: 0.1, borderRadius: '3px',
        color: obs.text.dim, border: `1px solid ${obs.border.default}`, bgcolor: obs.bg.hud,
      }}
    >
      {label}
    </Box>
  );
}
