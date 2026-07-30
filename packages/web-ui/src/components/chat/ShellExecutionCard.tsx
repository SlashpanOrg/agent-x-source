import { useState, memo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import TerminalIcon from '@mui/icons-material/Terminal';
import { colors, alphaColor, MONO } from '../../theme';
import type { ToolCall } from '../../chat/types';

function extractArgs(args: ToolCall['args']): Record<string, unknown> {
  if (!args) return {};
  if (typeof args === 'string') {
    try { return JSON.parse(args) as Record<string, unknown>; } catch { return {}; }
  }
  return args;
}

export function isShellTool(toolName: string): boolean {
  return toolName === 'shell_exec'
    || toolName === 'bash'
    || toolName === 'run_command'
    || toolName === 'execute'
    || toolName === 'shell_exec_streaming'
    || toolName === 'shell_background';
}

function extractCommand(tool: ToolCall): string {
  const parsed = extractArgs(tool.args);
  return String(parsed.command ?? '');
}

function extractExitCode(result: string): string | null {
  const exitMatch = result.match(/exit code[:\s]*(\d+)/i);
  if (exitMatch) return exitMatch[1];
  const codeMatch = result.match(/(?:^|\n)\s*(\d+)\s*(?:$|\n)/);
  if (codeMatch) return codeMatch[1];
  return null;
}

function ShellExecutionCardImpl({ tool, defaultExpanded = false }: { tool: ToolCall; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const command = extractCommand(tool);
  const isRunning = tool.status === 'running';
  const isError = tool.status === 'error';

  const output = isRunning ? tool.streamOutput : tool.result;
  // Cap rendered output to avoid lag on very large command outputs.
  const MAX_OUTPUT_CHARS = 8000;
  const trimmedOutput = output && output.length > MAX_OUTPUT_CHARS
    ? `${output.slice(0, MAX_OUTPUT_CHARS)}\n… (${output.length - MAX_OUTPUT_CHARS} more chars truncated)`
    : output;
  const exitCode = !isRunning && tool.result ? extractExitCode(tool.result) : null;

  const statusLabel = isRunning
    ? 'Running…'
    : isError
      ? 'Failed'
      : 'Done';

  return (
    <Box sx={{
      mb: 0.5,
      border: `1px solid ${isError ? alphaColor(colors.accent.red, '30') : isRunning ? alphaColor(colors.accent.blue, '30') : colors.border.subtle}`,
      borderRadius: 1,
      overflow: 'hidden',
      bgcolor: colors.bg.tertiary,
      transition: 'border-color 0.2s',
    }}>
      <Box
        onClick={() => setExpanded(!expanded)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1,
          py: 0.5,
          cursor: 'pointer',
          bgcolor: colors.bg.secondary,
          borderBottom: expanded ? `1px solid ${colors.border.subtle}` : 'none',
          '&:hover': { bgcolor: colors.bg.hover },
        }}
      >
        <Box sx={{ color: isRunning ? colors.accent.blue : isError ? colors.accent.red : colors.text.dim, display: 'flex', alignItems: 'center' }}>
          <TerminalIcon sx={{ fontSize: 14 }} />
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{
            fontSize: '0.68rem',
            fontFamily: MONO,
            fontWeight: 600,
            color: colors.text.primary,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {command || tool.name}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
          {isRunning ? (
            <Typography sx={{
              fontSize: '0.5rem',
              fontFamily: MONO,
              color: colors.accent.blue,
              fontWeight: 600,
              animation: 'agentx-pulse 1.4s ease-in-out infinite',
            }}>
              {statusLabel}
            </Typography>
          ) : isError ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
              <ErrorIcon sx={{ fontSize: 12, color: colors.accent.red }} />
              <Typography sx={{ fontSize: '0.5rem', fontFamily: MONO, color: colors.accent.red, fontWeight: 600 }}>
                {statusLabel}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
              <CheckCircleIcon sx={{ fontSize: 12, color: colors.accent.green }} />
              <Typography sx={{ fontSize: '0.5rem', fontFamily: MONO, color: colors.accent.green, fontWeight: 600 }}>
                {statusLabel}
              </Typography>
            </Box>
          )}
          {exitCode !== null && (
            <Box sx={{
              px: 0.5,
              py: 0.1,
              borderRadius: 0.5,
              bgcolor: exitCode === '0' ? alphaColor(colors.accent.green, '15') : alphaColor(colors.accent.red, '15'),
              border: `1px solid ${exitCode === '0' ? alphaColor(colors.accent.green, '30') : alphaColor(colors.accent.red, '30')}`,
            }}>
              <Typography sx={{
                fontSize: '0.45rem',
                fontFamily: MONO,
                fontWeight: 600,
                color: exitCode === '0' ? colors.accent.green : colors.accent.red,
              }}>
                exit {exitCode}
              </Typography>
            </Box>
          )}
        </Box>

        <IconButton size="small" sx={{ p: 0.25, color: colors.text.dim }} onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
          {expanded ? <ExpandLessIcon sx={{ fontSize: 14 }} /> : <ExpandMoreIcon sx={{ fontSize: 14 }} />}
        </IconButton>
      </Box>

      <Collapse in={expanded} unmountOnExit>
        <Box sx={{
          maxHeight: 80,
          overflow: 'auto',
          px: 1,
          py: 0.5,
          bgcolor: colors.bg.primary,
          contentVisibility: 'auto',
        }}>
          {command && (
            <Box
              component="pre"
              sx={{
                margin: 0,
                mb: 0.5,
                fontSize: '0.6rem',
                fontFamily: MONO,
                lineHeight: 1.5,
                color: colors.text.dim,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              $ {command}
            </Box>
          )}
          {output && (
            <Box
              component="pre"
              sx={{
                margin: 0,
                fontSize: '0.6rem',
                fontFamily: MONO,
                lineHeight: 1.5,
                color: isRunning ? colors.text.secondary : isError ? alphaColor(colors.accent.red, 'cc') : colors.text.secondary,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {trimmedOutput}
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

function shellExecutionCardPropsEqual(prev: { tool: ToolCall }, next: { tool: ToolCall }): boolean {
  return prev.tool.id === next.tool.id
    && prev.tool.status === next.tool.status
    && prev.tool.args === next.tool.args
    && prev.tool.result === next.tool.result
    && prev.tool.streamOutput === next.tool.streamOutput;
}

export const ShellExecutionCard = memo(ShellExecutionCardImpl, shellExecutionCardPropsEqual);
