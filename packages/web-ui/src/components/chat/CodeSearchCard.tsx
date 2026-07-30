import { useState, memo, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import FindInPageIcon from '@mui/icons-material/FindInPage';
import { colors, alphaColor, MONO } from '../../theme';
import type { ToolCall } from '../../chat/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractArgs(args: ToolCall['args']): Record<string, unknown> {
  if (!args) return {};
  if (typeof args === 'string') {
    try { return JSON.parse(args) as Record<string, unknown>; } catch { return {}; }
  }
  return args;
}

interface SearchResult {
  file: string;
  line: number;
  text: string;
}

function parseSearchResults(raw: string): SearchResult[] {
  const results: SearchResult[] = [];
  for (const line of raw.split('\n')) {
    const match = line.match(/^(.+?):(\d+)(?::\d+)?:\s*(.*)$/);
    if (match) results.push({ file: match[1], line: parseInt(match[2], 10), text: match[3] || '' });
  }
  return results;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightMatch(text: string, pattern: string) {
  if (!pattern) return text;
  const re = new RegExp(`(${escapeRegExp(pattern)})`, 'gi');
  const parts = text.split(re);
  return parts.map((part, i) =>
    re.test(part) && part.toLowerCase() === pattern.toLowerCase() ? (
      <Box
        key={i}
        component="span"
        sx={{
          bgcolor: alphaColor(colors.accent.blue, '30'),
          color: colors.text.primary,
          borderRadius: 0.25,
          px: 0.25,
        }}
      >
        {part}
      </Box>
    ) : (
      part
    ),
  );
}

export function isCodeSearchTool(toolName: string): boolean {
  return toolName === 'code_search'
    || toolName === 'code_grep'
    || toolName === 'grep'
    || toolName === 'file_find'
    || toolName === 'glob'
    || toolName === 'search_files'
    || toolName === 'code_references'
    || toolName === 'code_definitions';
}

// ─── Component ────────────────────────────────────────────────────────────────

function CodeSearchCardImpl({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(true);

  const parsedArgs = useMemo(() => extractArgs(tool.args), [tool.args]);
  const pattern = useMemo(() => {
    const p = parsedArgs.pattern;
    if (typeof p === 'string') return p;
    const q = parsedArgs.query;
    if (typeof q === 'string') return q;
    const s = parsedArgs.search;
    if (typeof s === 'string') return s;
    return '';
  }, [parsedArgs]);

  const rawResult = tool.result || tool.streamOutput || '';
  const results = useMemo(() => parseSearchResults(rawResult), [rawResult]);

  const grouped = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    for (const r of results) {
      const arr = map.get(r.file);
      if (arr) arr.push(r);
      else map.set(r.file, [r]);
    }
    return Array.from(map.entries());
  }, [results]);

  const isRunning = tool.status === 'running';
  const isError = tool.status === 'error';
  const statusLabel = isRunning ? 'Searching…' : isError ? 'Failed' : 'Done';

  const resultCount = results.length;
  const fileCount = grouped.length;
  const headerQuery = pattern || tool.name;

  return (
    <Box sx={{
      mb: 0.5,
      border: `1px solid ${isError ? alphaColor(colors.accent.red, '30') : isRunning ? alphaColor(colors.accent.blue, '30') : colors.border.subtle}`,
      borderRadius: 1,
      overflow: 'hidden',
      bgcolor: colors.bg.tertiary,
      transition: 'border-color 0.2s',
    }}>
      {/* ─── Header ─── */}
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
          <FindInPageIcon sx={{ fontSize: 14 }} />
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
            {headerQuery}
          </Typography>
          <Typography sx={{
            fontSize: '0.5rem',
            fontFamily: MONO,
            color: colors.text.dim,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {resultCount > 0 ? `${resultCount} results in ${fileCount} files` : tool.name}
          </Typography>
        </Box>

        {/* Result count badge */}
        {resultCount > 0 && (
          <Box sx={{
            flexShrink: 0,
            px: 0.5,
            py: 0.1,
            borderRadius: 0.5,
            bgcolor: alphaColor(colors.accent.blue, '15'),
            color: colors.accent.blue,
            fontSize: '0.5rem',
            fontFamily: MONO,
            fontWeight: 600,
            minWidth: '1.4em',
            textAlign: 'center',
          }}>
            {resultCount}
          </Box>
        )}

        {/* Status indicator */}
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
        </Box>

        <IconButton size="small" sx={{ p: 0.25, color: colors.text.dim }} onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
          {expanded ? <ExpandLessIcon sx={{ fontSize: 14 }} /> : <ExpandMoreIcon sx={{ fontSize: 14 }} />}
        </IconButton>
      </Box>

      {/* ─── Content ─── */}
      <Collapse in={expanded} unmountOnExit>
        <Box sx={{
          maxHeight: 300,
          overflow: 'auto',
          px: 1,
          py: 0.5,
          bgcolor: colors.bg.primary,
        }}>
          {grouped.length > 0 ? (
            grouped.map(([file, entries]) => (
              <Box key={file} sx={{ mb: 0.75 }}>
                <Typography sx={{
                  fontSize: '0.55rem',
                  fontFamily: MONO,
                  fontWeight: 600,
                  color: colors.accent.cyan,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  py: 0.25,
                  borderBottom: `1px solid ${colors.border.subtle}`,
                  mb: 0.25,
                }}>
                  {file}
                </Typography>
                {entries.map((entry, idx) => (
                  <Box
                    key={`${file}-${entry.line}-${idx}`}
                    sx={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 0.5,
                      py: 0.1,
                      px: 0.5,
                      '&:hover': { bgcolor: colors.bg.hover },
                      borderRadius: 0.25,
                    }}
                  >
                    <Box component="span" sx={{
                      flexShrink: 0,
                      minWidth: '2.5em',
                      fontSize: '0.55rem',
                      fontFamily: MONO,
                      color: colors.text.dim,
                      textAlign: 'right',
                      userSelect: 'none',
                      pt: 0.1,
                    }}>
                      {entry.line}
                    </Box>
                    <Box component="span" sx={{
                      flex: 1,
                      fontSize: '0.55rem',
                      fontFamily: MONO,
                      color: colors.text.secondary,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      lineHeight: 1.5,
                    }}>
                      {highlightMatch(entry.text, pattern)}
                    </Box>
                  </Box>
                ))}
              </Box>
            ))
          ) : rawResult ? (
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
              {rawResult}
            </Box>
          ) : (
            <Typography sx={{
              fontSize: '0.55rem',
              fontFamily: MONO,
              color: colors.text.dim,
              fontStyle: 'italic',
              py: 0.5,
            }}>
              {isRunning ? 'Searching…' : 'No results'}
            </Typography>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

function codeSearchCardPropsEqual(prev: { tool: ToolCall }, next: { tool: ToolCall }): boolean {
  return prev.tool.id === next.tool.id
    && prev.tool.status === next.tool.status
    && prev.tool.args === next.tool.args
    && prev.tool.result === next.tool.result
    && prev.tool.streamOutput === next.tool.streamOutput;
}

export const CodeSearchCard = memo(CodeSearchCardImpl, codeSearchCardPropsEqual);
