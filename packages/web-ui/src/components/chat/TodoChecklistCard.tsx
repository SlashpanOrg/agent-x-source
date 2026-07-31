// TodoChecklistCard.tsx — live todo checklist rendered as an interactive card
// in the message stream. Shows task items with status icons that update in
// real-time as the agent works through them.

import { memo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import CircularProgress from '@mui/material/CircularProgress';
import { colors, MONO } from '../../theme';
import type { TodoItem } from '../../api';

export interface TodoChecklistCardProps {
  todos: TodoItem[];
}

function TodoChecklistCardImpl({ todos }: TodoChecklistCardProps) {
  if (!todos || todos.length === 0) return null;

  const completed = todos.filter((t) => t.status === 'completed').length;
  const inProgress = todos.filter((t) => t.status === 'in-progress').length;
  const total = todos.length;
  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

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
          Tasks
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
              bgcolor: inProgress > 0 ? colors.accent.blue : colors.accent.green,
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
          {completed}/{total}
        </Typography>
      </Box>

      {/* Todo items */}
      <Box sx={{ px: 1.25, py: 0.75 }}>
        {todos.map((todo, idx) => {
          const isLast = idx === todos.length - 1;
          const isCompleted = todo.status === 'completed';
          const isInProgress = todo.status === 'in-progress';

          return (
            <Box
              key={todo.id}
              sx={{
                display: 'flex',
                gap: 0.75,
                position: 'relative',
                pb: isLast ? 0 : 0.5,
              }}
            >
              {/* Status icon */}
              <Box sx={{
                flexShrink: 0,
                width: 16,
                height: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mt: 0.125,
              }}>
                {isCompleted ? (
                  <CheckCircleIcon sx={{ fontSize: 14, color: colors.accent.green }} />
                ) : isInProgress ? (
                  <CircularProgress size={14} thickness={4} sx={{ color: colors.accent.blue }} />
                ) : (
                  <RadioButtonUncheckedIcon sx={{ fontSize: 14, color: colors.text.dim }} />
                )}
              </Box>

              {/* Title + detail */}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{
                  fontSize: '0.68rem',
                  fontFamily: MONO,
                  lineHeight: 1.4,
                  color: isCompleted
                    ? colors.text.dim
                    : isInProgress
                      ? colors.text.primary
                      : colors.text.secondary,
                  textDecoration: isCompleted ? 'line-through' : 'none',
                  fontWeight: isInProgress ? 600 : 400,
                }}>
                  {todo.title}
                </Typography>
                {todo.detail && (
                  <Typography sx={{
                    fontSize: '0.55rem',
                    fontFamily: MONO,
                    lineHeight: 1.4,
                    color: colors.text.dim,
                    mt: 0.125,
                    opacity: isCompleted ? 0.5 : 1,
                  }}>
                    {todo.detail}
                  </Typography>
                )}
              </Box>

              {/* Status badge */}
              <Box sx={{ flexShrink: 0 }}>
                {isInProgress && (
                  <Typography sx={{
                    fontSize: '0.45rem',
                    fontFamily: MONO,
                    color: colors.accent.blue,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    animation: 'agentx-pulse 1.4s ease-in-out infinite',
                  }}>
                    Active
                  </Typography>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function todoPropsEqual(prev: TodoChecklistCardProps, next: TodoChecklistCardProps): boolean {
  if (prev.todos.length !== next.todos.length) return false;
  for (let i = 0; i < prev.todos.length; i++) {
    const a = prev.todos[i];
    const b = next.todos[i];
    if (a.id !== b.id || a.status !== b.status || a.title !== b.title || a.detail !== b.detail) return false;
  }
  return true;
}

export const TodoChecklistCard = memo(TodoChecklistCardImpl, todoPropsEqual);
