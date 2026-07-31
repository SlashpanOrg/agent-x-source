// PlanRoadmapCard.tsx — visual roadmap of the agent's multi-step plan.
// Renders numbered steps with status indicators and connecting lines.
// Updates in real-time as the agent progresses through the plan.

import { memo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import CircularProgress from '@mui/material/CircularProgress';
import { colors, alphaColor, MONO } from '../../theme';

export interface PlanStep {
  text: string;
  status?: 'pending' | 'in-progress' | 'done';
}

export interface PlanRoadmapCardProps {
  steps: string[];
  /** Optional status map — index → status. If absent, all steps are 'pending'. */
  stepStatuses?: Record<number, 'pending' | 'in-progress' | 'done'>;
  /** Currently active step index (0-based). */
  activeStep?: number;
}

function PlanRoadmapCardImpl({ steps, stepStatuses, activeStep }: PlanRoadmapCardProps) {
  if (!steps || steps.length === 0) return null;

  const getStatus = (idx: number): PlanStep['status'] => {
    if (stepStatuses?.[idx]) return stepStatuses[idx];
    if (activeStep !== undefined) {
      if (idx < activeStep) return 'done';
      if (idx === activeStep) return 'in-progress';
    }
    return 'pending';
  };

  const completedCount = steps.filter((_, i) => getStatus(i) === 'done').length;
  const totalCount = steps.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <Box sx={{
      mb: 0.5,
      border: `1px solid ${colors.border.subtle}`,
      borderRadius: 1.5,
      overflow: 'hidden',
      bgcolor: colors.bg.tertiary,
    }}>
      {/* Header */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1.25,
        py: 0.625,
        bgcolor: colors.bg.secondary,
        borderBottom: `1px solid ${colors.border.subtle}`,
      }}>
        <Typography sx={{
          fontSize: '0.65rem',
          fontFamily: MONO,
          fontWeight: 700,
          color: colors.text.primary,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          Plan
        </Typography>
        <Box sx={{ flex: 1 }}>
          <Box sx={{
            height: 3,
            borderRadius: 2,
            bgcolor: colors.bg.hover,
            overflow: 'hidden',
          }}>
            <Box sx={{
              height: '100%',
              width: `${progressPercent}%`,
              bgcolor: colors.accent.blue,
              borderRadius: 2,
              transition: 'width 0.4s ease',
            }} />
          </Box>
        </Box>
        <Typography sx={{
          fontSize: '0.5rem',
          fontFamily: MONO,
          color: colors.text.dim,
          flexShrink: 0,
        }}>
          {completedCount}/{totalCount}
        </Typography>
      </Box>

      {/* Steps */}
      <Box sx={{ px: 1.25, py: 0.75 }}>
        {steps.map((step, idx) => {
          const status = getStatus(idx);
          const isLast = idx === steps.length - 1;
          return (
            <Box
              key={idx}
              sx={{
                display: 'flex',
                gap: 0.75,
                position: 'relative',
                pb: isLast ? 0 : 0.625,
              }}
            >
              {/* Connector line */}
              {!isLast && (
                <Box sx={{
                  position: 'absolute',
                  left: '7px',
                  top: '18px',
                  bottom: 0,
                  width: '1px',
                  bgcolor: status === 'done' ? alphaColor(colors.accent.green, '40') : colors.border.subtle,
                }} />
              )}

              {/* Status icon */}
              <Box sx={{
                flexShrink: 0,
                width: 16,
                height: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mt: 0.125,
                zIndex: 1,
              }}>
                {status === 'done' ? (
                  <CheckCircleIcon sx={{ fontSize: 14, color: colors.accent.green }} />
                ) : status === 'in-progress' ? (
                  <CircularProgress size={14} thickness={4} sx={{ color: colors.accent.blue }} />
                ) : (
                  <RadioButtonUncheckedIcon sx={{ fontSize: 14, color: colors.text.dim }} />
                )}
              </Box>

              {/* Step text */}
              <Typography sx={{
                fontSize: '0.68rem',
                fontFamily: MONO,
                lineHeight: 1.5,
                color: status === 'done'
                  ? colors.text.dim
                  : status === 'in-progress'
                    ? colors.text.primary
                    : colors.text.secondary,
                textDecoration: status === 'done' ? 'line-through' : 'none',
                fontWeight: status === 'in-progress' ? 600 : 400,
                flex: 1,
              }}>
                {step}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function planPropsEqual(prev: PlanRoadmapCardProps, next: PlanRoadmapCardProps): boolean {
  if (prev.activeStep !== next.activeStep) return false;
  if (prev.steps.length !== next.steps.length) return false;
  for (let i = 0; i < prev.steps.length; i++) {
    if (prev.steps[i] !== next.steps[i]) return false;
  }
  if (prev.stepStatuses === next.stepStatuses) return true;
  if (!prev.stepStatuses || !next.stepStatuses) return false;
  const prevKeys = Object.keys(prev.stepStatuses);
  const nextKeys = Object.keys(next.stepStatuses);
  if (prevKeys.length !== nextKeys.length) return false;
  for (const k of prevKeys) {
    if (prev.stepStatuses[Number(k)] !== next.stepStatuses[Number(k)]) return false;
  }
  return true;
}

export const PlanRoadmapCard = memo(PlanRoadmapCardImpl, planPropsEqual);
