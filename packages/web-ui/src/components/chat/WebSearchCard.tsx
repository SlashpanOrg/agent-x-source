import { useState, memo, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import PublicIcon from '@mui/icons-material/Public';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { colors, alphaColor, MONO } from '../../theme';
import type { ToolCall } from '../../chat/types';

const WEB_SEARCH_TOOLS = new Set([
  'web_search',
  'web_fetch',
  'web_scrape',
  'http_get',
  'http_post',
  'http_request',
  'http_download',
  'web_browse',
]);

export function isWebSearchTool(toolName: string): boolean {
  return WEB_SEARCH_TOOLS.has(toolName);
}

function extractArgs(args: ToolCall['args']): Record<string, unknown> {
  if (!args) return {};
  if (typeof args === 'string') {
    try { return JSON.parse(args) as Record<string, unknown>; } catch { return {}; }
  }
  return args;
}

interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

function parseWebResults(raw: string): WebResult[] {
  const results: WebResult[] = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\d+\.\s*(.+?)\s*[-–—]\s*(https?:\/\/\S+)/);
    if (match) {
      const snippet = lines[i + 1]?.trim() || '';
      results.push({ title: match[1], url: match[2], snippet });
    }
  }
  return results;
}

function openUrl(url: string): void {
  const agentx = (window as unknown as { agentx?: { openExternal?: (url: string) => void } }).agentx;
  if (agentx?.openExternal) {
    agentx.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '…';
}

function WebSearchCardImpl({ tool, defaultExpanded = false }: { tool: ToolCall; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showFull, setShowFull] = useState(false);

  const parsed = useMemo(() => extractArgs(tool.args), [tool.args]);
  const query = typeof parsed.query === 'string' ? parsed.query : '';
  const url = typeof parsed.url === 'string' ? parsed.url : '';
  const headerLabel = query || url || tool.name;

  const isSearch = tool.name === 'web_search';
  const isFetch = tool.name === 'web_fetch' || tool.name === 'web_scrape';

  const rawResult = tool.result || tool.streamOutput || '';

  const webResults = useMemo(() => {
    if (!isSearch || !rawResult) return [];
    return parseWebResults(rawResult);
  }, [isSearch, rawResult]);

  const isRunning = tool.status === 'running';
  const isError = tool.status === 'error';

  const actionLabel = isSearch ? 'Searching' : isFetch ? 'Fetching' : 'Requesting';
  const statusLabel = isRunning
    ? `${actionLabel}…`
    : isError
      ? 'Failed'
      : 'Done';

  const resultCount = webResults.length;
  const charCount = rawResult.length;
  const MAX_CHARS = 2000;
  const isLong = charCount > MAX_CHARS;
  const displayText = isLong && !showFull ? truncate(rawResult, MAX_CHARS) : rawResult;

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
          <PublicIcon sx={{ fontSize: 14 }} />
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
            {headerLabel}
          </Typography>
          <Typography sx={{
            fontSize: '0.5rem',
            fontFamily: MONO,
            color: colors.text.dim,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {tool.name}
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
          {resultCount > 0 && (
            <Typography sx={{ fontSize: '0.45rem', fontFamily: MONO, color: colors.text.dim }}>
              {resultCount} results
            </Typography>
          )}
          {resultCount === 0 && charCount > 0 && (
            <Typography sx={{ fontSize: '0.45rem', fontFamily: MONO, color: colors.text.dim }}>
              {charCount} chars
            </Typography>
          )}
        </Box>

        <IconButton size="small" sx={{ p: 0.25, color: colors.text.dim }} onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
          {expanded ? <ExpandLessIcon sx={{ fontSize: 14 }} /> : <ExpandMoreIcon sx={{ fontSize: 14 }} />}
        </IconButton>
      </Box>

      <Collapse in={expanded} unmountOnExit>
        <Box sx={{
          maxHeight: 140,
          overflow: 'auto',
          px: 1,
          py: 0.5,
          bgcolor: colors.bg.primary,
          contentVisibility: 'auto',
        }}>
          {webResults.length > 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {webResults.map((res, idx) => (
                <Box
                  key={idx}
                  sx={{
                    border: `1px solid ${colors.border.subtle}`,
                    borderRadius: 1,
                    p: 0.5,
                    bgcolor: colors.bg.tertiary,
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.25 }}>
                    <Typography sx={{
                      flex: 1,
                      fontSize: '0.6rem',
                      fontFamily: MONO,
                      fontWeight: 600,
                      color: colors.text.primary,
                      lineHeight: 1.4,
                    }}>
                      {res.title}
                    </Typography>
                    <IconButton
                      size="small"
                      sx={{ p: 0.25, color: colors.text.dim, flexShrink: 0 }}
                      onClick={() => openUrl(res.url)}
                    >
                      <OpenInNewIcon sx={{ fontSize: 12 }} />
                    </IconButton>
                  </Box>
                  <Typography
                    component="a"
                    onClick={(e) => { e.preventDefault(); openUrl(res.url); }}
                    sx={{
                      display: 'block',
                      fontSize: '0.5rem',
                      fontFamily: MONO,
                      color: colors.accent.blue,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      textDecoration: 'none',
                      '&:hover': { textDecoration: 'underline' },
                    }}
                  >
                    {res.url}
                  </Typography>
                  {res.snippet && (
                    <Typography sx={{
                      fontSize: '0.55rem',
                      fontFamily: MONO,
                      color: colors.text.dim,
                      lineHeight: 1.4,
                      mt: 0.25,
                    }}>
                      {res.snippet}
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
          )}

          {webResults.length === 0 && isFetch && displayText && (
            <Box>
              <Box
                component="pre"
                sx={{
                  margin: 0,
                  fontSize: '0.6rem',
                  fontFamily: MONO,
                  lineHeight: 1.5,
                  color: colors.text.secondary,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {displayText}
              </Box>
              {isLong && (
                <Box
                  onClick={() => setShowFull(!showFull)}
                  sx={{
                    display: 'inline-block',
                    mt: 0.5,
                    fontSize: '0.5rem',
                    fontFamily: MONO,
                    color: colors.accent.blue,
                    cursor: 'pointer',
                    '&:hover': { textDecoration: 'underline' },
                  }}
                >
                  {showFull ? 'show less' : 'show more'}
                </Box>
              )}
            </Box>
          )}

          {webResults.length === 0 && !isFetch && rawResult && (
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
          )}

          {!rawResult && isRunning && (
            <Typography sx={{
              fontSize: '0.55rem',
              fontFamily: MONO,
              color: colors.text.dim,
              fontStyle: 'italic',
            }}>
              Waiting for results…
            </Typography>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

function webSearchCardPropsEqual(prev: { tool: ToolCall }, next: { tool: ToolCall }): boolean {
  return prev.tool.id === next.tool.id
    && prev.tool.status === next.tool.status
    && prev.tool.args === next.tool.args
    && prev.tool.result === next.tool.result
    && prev.tool.streamOutput === next.tool.streamOutput;
}

export const WebSearchCard = memo(WebSearchCardImpl, webSearchCardPropsEqual);
