import { useState, memo, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import MergeTypeIcon from '@mui/icons-material/MergeType';
import { colors, alphaColor, MONO } from '../../theme';
import type { ToolCall } from '../../chat/types';

const GIT_TOOLS = new Set([
  'git_status', 'git_diff', 'git_log', 'git_commit', 'git_add', 'git_branch',
  'git_checkout', 'git_stash', 'git_blame', 'git_show', 'git_push', 'git_pull',
  'git_merge', 'git_init', 'git_clone', 'git_remote', 'git_tag', 'git_reset',
  'git_cherry_pick', 'git_rebase', 'git_config',
]);

export function isGitTool(toolName: string): boolean {
  return GIT_TOOLS.has(toolName);
}

function extractArgs(args: ToolCall['args']): Record<string, unknown> {
  if (!args) return {};
  if (typeof args === 'string') {
    try { return JSON.parse(args) as Record<string, unknown>; } catch { return {}; }
  }
  return args;
}

function operationLabel(name: string): string {
  return name.replace(/^git_/, 'git ');
}

function subtitleFor(tool: ToolCall, parsed: Record<string, unknown>): string {
  switch (tool.name) {
    case 'git_commit':
      return typeof parsed.message === 'string' ? parsed.message
        : typeof parsed.m === 'string' ? parsed.m : '';
    case 'git_branch':
      return typeof parsed.name === 'string' ? parsed.name
        : typeof parsed.branch === 'string' ? parsed.branch : '';
    case 'git_checkout':
      return typeof parsed.branch === 'string' ? parsed.branch
        : typeof parsed.name === 'string' ? parsed.name : '';
    case 'git_tag':
      return typeof parsed.name === 'string' ? parsed.name : '';
    case 'git_push':
    case 'git_pull':
      return typeof parsed.remote === 'string' ? parsed.remote : '';
    case 'git_clone':
      return typeof parsed.url === 'string' ? parsed.url
        : typeof parsed.repo === 'string' ? parsed.repo : '';
    case 'git_remote':
      return typeof parsed.name === 'string' ? parsed.name : '';
    case 'git_reset':
      return typeof parsed.target === 'string' ? parsed.target
        : typeof parsed.commit === 'string' ? parsed.commit : '';
    case 'git_rebase':
      return typeof parsed.branch === 'string' ? parsed.branch : '';
    case 'git_cherry_pick':
      return typeof parsed.commit === 'string' ? parsed.commit : '';
    case 'git_add':
      return typeof parsed.path === 'string' ? parsed.path
        : typeof parsed.files === 'string' ? parsed.files : '';
    case 'git_stash':
      return typeof parsed.message === 'string' ? parsed.message : '';
    case 'git_config':
      return typeof parsed.key === 'string' ? parsed.key : '';
    case 'git_show':
    case 'git_blame':
      return typeof parsed.file === 'string' ? parsed.file
        : typeof parsed.path === 'string' ? parsed.path
        : typeof parsed.commit === 'string' ? parsed.commit : '';
    default:
      return '';
  }
}

type DiffLineType = 'add' | 'del' | 'hunk' | 'meta' | 'ctx';

interface DiffLine {
  type: DiffLineType;
  text: string;
}

function parseDiffLines(text: string): DiffLine[] {
  return text.split('\n').map((line) => {
    if (line.startsWith('+++')) return { type: 'meta', text: line };
    if (line.startsWith('---')) return { type: 'meta', text: line };
    if (line.startsWith('@@')) return { type: 'hunk', text: line };
    if (line.startsWith('diff ')) return { type: 'meta', text: line };
    if (line.startsWith('index ')) return { type: 'meta', text: line };
    if (line.startsWith('+')) return { type: 'add', text: line.slice(1) };
    if (line.startsWith('-')) return { type: 'del', text: line.slice(1) };
    if (line.startsWith(' ')) return { type: 'ctx', text: line.slice(1) };
    return { type: 'ctx', text: line };
  });
}

interface StatusEntry {
  code: string;
  file: string;
  kind: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' | 'other';
}

function parseStatusLines(text: string): StatusEntry[] {
  return text.split('\n').map((line) => {
    if (!line.trim()) return null;
    const code = line.slice(0, 2);
    const file = line.slice(3).trim();
    let kind: StatusEntry['kind'] = 'other';
    if (code === '??') kind = 'untracked';
    else if (code.startsWith('M')) kind = 'modified';
    else if (code.startsWith('A')) kind = 'added';
    else if (code.startsWith('D')) kind = 'deleted';
    else if (code.startsWith('R')) kind = 'renamed';
    return { code, file, kind };
  }).filter((e): e is StatusEntry => e !== null);
}

interface LogEntry {
  hash: string;
  author: string;
  date: string;
  message: string;
}

function parseLogLines(text: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const lines = text.split('\n');
  let current: LogEntry | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = line.match(/^([0-9a-fA-F]{6,40})\s+(.+?)\s+-\s+(\d{4}-\d{2}-\d{2})\s+-\s+(.*)$/);
    if (m) {
      if (current) entries.push(current);
      current = { hash: m[1], author: m[2], date: m[3], message: m[4] };
    } else if (current && line.startsWith('    ')) {
      current.message += `\n${line.trim()}`;
    } else if (current) {
      current.message += `\n${line}`;
    }
  }
  if (current) entries.push(current);
  return entries;
}

function diffLineSx(type: DiffLineType) {
  switch (type) {
    case 'add':
      return {
        borderLeft: `2px solid ${colors.accent.green}`,
        bgcolor: alphaColor(colors.accent.green, '08'),
        color: alphaColor(colors.accent.green, 'cc'),
        prefix: '+',
      };
    case 'del':
      return {
        borderLeft: `2px solid ${colors.accent.red}`,
        bgcolor: alphaColor(colors.accent.red, '08'),
        color: alphaColor(colors.accent.red, 'cc'),
        prefix: '-',
      };
    case 'hunk':
      return {
        borderLeft: `2px solid ${colors.accent.blue}`,
        bgcolor: alphaColor(colors.accent.blue, '08'),
        color: alphaColor(colors.accent.blue, 'cc'),
        prefix: '@',
      };
    case 'meta':
      return {
        borderLeft: '2px solid transparent',
        bgcolor: 'transparent',
        color: colors.text.dim,
        prefix: ' ',
      };
    default:
      return {
        borderLeft: '2px solid transparent',
        bgcolor: 'transparent',
        color: colors.text.dim,
        prefix: ' ',
      };
  }
}

function statusColor(kind: StatusEntry['kind']): string {
  switch (kind) {
    case 'modified': return colors.accent.orange;
    case 'added': return colors.accent.green;
    case 'deleted': return colors.accent.red;
    case 'untracked': return colors.text.dim;
    case 'renamed': return colors.accent.purple;
    default: return colors.text.secondary;
  }
}

function GitOperationCardImpl({ tool, defaultExpanded = false }: { tool: ToolCall; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const parsed = useMemo(() => extractArgs(tool.args), [tool.args]);
  const subtitle = useMemo(() => subtitleFor(tool, parsed), [tool, parsed]);

  const output = tool.streamOutput || tool.result || '';

  const diffLines = useMemo(
    () => (tool.name === 'git_diff' ? parseDiffLines(output) : null),
    [tool.name, output],
  );
  const statusEntries = useMemo(
    () => (tool.name === 'git_status' ? parseStatusLines(output) : null),
    [tool.name, output],
  );
  const logEntries = useMemo(
    () => (tool.name === 'git_log' ? parseLogLines(output) : null),
    [tool.name, output],
  );

  const isRunning = tool.status === 'running';
  const isError = tool.status === 'error';
  const opName = operationLabel(tool.name);
  const statusLabel = isRunning ? 'Running…' : isError ? 'Failed' : 'Done';

  const lineCount = diffLines?.length
    ?? statusEntries?.length
    ?? logEntries?.length
    ?? (output ? output.split('\n').length : 0);

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
        <Box sx={{ color: isRunning ? colors.accent.blue : isError ? colors.accent.red : colors.accent.purple, display: 'flex', alignItems: 'center' }}>
          <MergeTypeIcon sx={{ fontSize: 14 }} />
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
            {opName}
          </Typography>
          {subtitle && (
            <Typography sx={{
              fontSize: '0.5rem',
              fontFamily: MONO,
              color: colors.text.dim,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {subtitle}
            </Typography>
          )}
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
          {lineCount > 0 && (
            <Typography sx={{ fontSize: '0.45rem', fontFamily: MONO, color: colors.text.dim }}>
              {lineCount} lines
            </Typography>
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
          {diffLines && diffLines.length > 0 && (
            <Box sx={{ fontFamily: MONO, fontSize: '0.6rem', lineHeight: 1.5 }}>
              {diffLines.map((line, idx) => {
                const sx = diffLineSx(line.type);
                return (
                  <Box
                    key={idx}
                    sx={{
                      display: 'flex',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      py: 0.05,
                      px: 0.5,
                      borderLeft: sx.borderLeft,
                      bgcolor: sx.bgcolor,
                      color: sx.color,
                    }}
                  >
                    <Box component="span" sx={{ flexShrink: 0, width: '1.2em', textAlign: 'center', color: colors.text.dim, userSelect: 'none' }}>
                      {sx.prefix}
                    </Box>
                    <Box component="span" sx={{ flex: 1 }}>
                      {line.text || ' '}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          )}

          {statusEntries && statusEntries.length > 0 && (
            <Box sx={{ fontFamily: MONO, fontSize: '0.6rem', lineHeight: 1.5 }}>
              {statusEntries.map((entry, idx) => (
                <Box
                  key={idx}
                  sx={{
                    display: 'flex',
                    gap: 0.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    py: 0.05,
                    px: 0.5,
                  }}
                >
                  <Box component="span" sx={{ flexShrink: 0, width: '2em', color: statusColor(entry.kind), fontWeight: 600 }}>
                    {entry.code}
                  </Box>
                  <Box component="span" sx={{ flex: 1, color: colors.text.secondary }}>
                    {entry.file}
                  </Box>
                </Box>
              ))}
            </Box>
          )}

          {logEntries && logEntries.length > 0 && (
            <Box sx={{ fontFamily: MONO, fontSize: '0.6rem', lineHeight: 1.5 }}>
              {logEntries.map((entry, idx) => (
                <Box
                  key={idx}
                  sx={{
                    py: 0.25,
                    px: 0.5,
                    borderBottom: idx < logEntries.length - 1 ? `1px solid ${colors.border.subtle}` : 'none',
                  }}
                >
                  <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <Box component="span" sx={{ color: colors.accent.orange, fontWeight: 600 }}>
                      {entry.hash.slice(0, 7)}
                    </Box>
                    <Box component="span" sx={{ color: colors.accent.blue }}>
                      {entry.author}
                    </Box>
                    <Box component="span" sx={{ color: colors.text.dim }}>
                      {entry.date}
                    </Box>
                  </Box>
                  <Box component="div" sx={{ color: colors.text.secondary, mt: 0.25, whiteSpace: 'pre-wrap' }}>
                    {entry.message}
                  </Box>
                </Box>
              ))}
            </Box>
          )}

          {tool.name === 'git_commit' && (
            <Box sx={{ fontFamily: MONO, fontSize: '0.6rem', lineHeight: 1.5 }}>
              {subtitle && (
                <Box sx={{ py: 0.25, px: 0.5, color: colors.text.primary, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {subtitle}
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
                    color: colors.text.dim,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    px: 0.5,
                  }}
                >
                  {output}
                </Box>
              )}
            </Box>
          )}

          {!diffLines && !statusEntries && !logEntries && tool.name !== 'git_commit' && output && (
            <Box
              component="pre"
              sx={{
                margin: 0,
                fontSize: '0.6rem',
                fontFamily: MONO,
                lineHeight: 1.5,
                color: colors.text.dim,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {output}
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

function gitOperationCardPropsEqual(prev: { tool: ToolCall }, next: { tool: ToolCall }): boolean {
  return prev.tool.id === next.tool.id
    && prev.tool.status === next.tool.status
    && prev.tool.args === next.tool.args
    && prev.tool.result === next.tool.result
    && prev.tool.streamOutput === next.tool.streamOutput;
}

export const GitOperationCard = memo(GitOperationCardImpl, gitOperationCardPropsEqual);
