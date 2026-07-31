// SpyHudScrapePanel — spy HUD themed web scrape panel for knowledge base.
// Features: URL input, terminal-style scrolling logs with literal scraped
// content snippets, thought orb loader, rescrape button with smart status.

import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import { ThinkingOrb } from 'thinking-orbs';
import LinkIcon from '@mui/icons-material/Link';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import RefreshIcon from '@mui/icons-material/Refresh';
import TerminalIcon from '@mui/icons-material/Terminal';
import { colors, alphaColor, MONO, getActiveScheme } from '../theme';
import type { KnowledgeSource, ScrapeStatus } from '@agentx/shared';

// ─── Types ───

interface ScrapeLogLine {
  id: number;
  text: string;
  kind: 'stage' | 'content' | 'error' | 'success';
  timestamp: number;
}

interface SpyHudScrapePanelProps {
  /** Current scrape status detail lines from WS (keyed by sourceId or '__scrape__'). */
  scrapeDetails: Record<string, string>;
  /** Active scrape source ID (null when idle). */
  activeScrapeId: string | null;
  /** Called when user submits a URL to scrape. */
  onScrape: (url: string) => Promise<void>;
  /** Called when user clicks rescrape on an existing URL source. */
  onRescrape: (id: string) => Promise<void>;
  /** URL sources for the rescrape list. */
  urlSources: KnowledgeSource[];
}

// ─── Helpers ───

function scrapeStatusColor(status?: ScrapeStatus): string {
  switch (status) {
    case 'fresh': return colors.accent.green;
    case 'unchanged': return colors.accent.blue;
    case 'updated': return colors.accent.cyan;
    case 'unavailable': return colors.accent.orange;
    case 'error': return colors.accent.red;
    default: return colors.text.dim;
  }
}

function scrapeStatusLabel(status?: ScrapeStatus): string {
  switch (status) {
    case 'fresh': return 'FRESH';
    case 'unchanged': return 'UNCHANGED';
    case 'updated': return 'UPDATED';
    case 'unavailable': return 'UNAVAILABLE';
    case 'error': return 'ERROR';
    default: return '—';
  }
}

function isUrlValid(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ─── Component ───

export function SpyHudScrapePanel({
  scrapeDetails,
  activeScrapeId,
  onScrape,
  onRescrape,
  urlSources,
}: SpyHudScrapePanelProps) {
  const [urlInput, setUrlInput] = useState('');
  const [logs, setLogs] = useState<ScrapeLogLine[]>([]);
  const [scraping, setScraping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logIdRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const prevDetailRef = useRef<string | undefined>(undefined);

  // Stream WS scrape details into the terminal log
  useEffect(() => {
    const key = activeScrapeId ?? '__scrape__';
    const detail = scrapeDetails[key];
    if (!detail || detail === prevDetailRef.current) return;
    prevDetailRef.current = detail;

    const id = ++logIdRef.current;
    const kind: ScrapeLogLine['kind'] =
      detail.startsWith('>') ? 'content' :
      detail.includes('error') || detail.includes('failed') || detail.includes('unavailable') ? 'error' :
      detail.includes('ready') || detail.includes('complete') || detail.includes('unchanged') ? 'success' :
      'stage';

    setLogs((prev) => {
      // Cap at 200 lines to prevent memory bloat — ring buffer style
      const next = [...prev, { id, text: detail, kind, timestamp: Date.now() }];
      return next.length > 200 ? next.slice(-200) : next;
    });
  }, [scrapeDetails, activeScrapeId]);

  // Auto-scroll to bottom when new logs arrive (only if user is near bottom)
  useEffect(() => {
    const el = logContainerRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (isNearBottom) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [logs]);

  // Clear logs when scrape completes (status becomes ready/failed)
  useEffect(() => {
    if (!activeScrapeId) {
      // Keep logs visible briefly after completion, then clear on next scrape start
    }
  }, [activeScrapeId]);

  const handleScrape = useCallback(async () => {
    const url = urlInput.trim();
    if (!isUrlValid(url)) {
      setError('Enter a valid http(s) URL');
      return;
    }
    setError(null);
    setScraping(true);
    setLogs([]);
    prevDetailRef.current = undefined;
    try {
      await onScrape(url);
      setUrlInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScraping(false);
    }
  }, [urlInput, onScrape]);

  const handleRescrape = useCallback(async (id: string) => {
    setError(null);
    setScraping(true);
    setLogs([]);
    prevDetailRef.current = undefined;
    try {
      await onRescrape(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScraping(false);
    }
  }, [onRescrape]);

  const orbState = scraping ? 'searching' : 'working';
  const orbTheme = getActiveScheme() === 'dark' ? 'dark' : 'light';

  return (
    <Box
      sx={{
        border: `1px solid ${alphaColor(colors.accent.blue, 0.25)}`,
        borderRadius: 1,
        bgcolor: alphaColor(colors.accent.blue, 0.04),
        overflow: 'hidden',
        mb: 2,
      }}
    >
      {/* ─── Header bar ─── */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 0.75,
          borderBottom: `1px solid ${alphaColor(colors.accent.blue, 0.15)}`,
          bgcolor: alphaColor(colors.accent.blue, 0.08),
        }}
      >
        <TerminalIcon sx={{ fontSize: 14, color: colors.accent.blue }} />
        <Typography
          sx={{
            fontFamily: MONO,
            fontSize: '0.6rem',
            letterSpacing: '1.5px',
            color: colors.accent.blue,
            fontWeight: 600,
            textTransform: 'uppercase',
          }}
        >
          WEB SCRAPE · RAG INGEST
        </Typography>
        <Box sx={{ flex: 1 }} />
        <ThinkingOrb
          state={orbState}
          size={20}
          theme={orbTheme}
          aria-label={scraping ? 'Scraping…' : 'Idle'}
          style={{ flexShrink: 0, opacity: scraping ? 1 : 0.4 }}
        />
      </Box>

      {/* ─── URL input ─── */}
      <Box sx={{ px: 1.5, py: 1, display: 'flex', gap: 1, alignItems: 'flex-start' }}>
        <TextField
          size="small"
          fullWidth
          placeholder="https://example.com/blog/post"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !scraping) void handleScrape();
          }}
          disabled={scraping}
          sx={{
            '& .MuiInputBase-input': {
              fontFamily: MONO,
              fontSize: '0.7rem',
              color: colors.text.primary,
              py: 0.5,
              px: 1,
            },
            '& .MuiOutlinedInput-root': {
              bgcolor: colors.bg.tertiary,
              '& fieldset': { borderColor: colors.border.default },
              '&:hover fieldset': { borderColor: colors.border.strong },
              '&.Mui-focused fieldset': { borderColor: colors.accent.blue },
            },
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <LinkIcon sx={{ fontSize: 14, color: colors.text.dim }} />
              </InputAdornment>
            ),
          }}
        />
        <Tooltip title="Scrape & ingest">
          <IconButton
            size="small"
            onClick={() => void handleScrape()}
            disabled={scraping || !urlInput.trim()}
            sx={{
              color: colors.accent.blue,
              border: `1px solid ${alphaColor(colors.accent.blue, 0.3)}`,
              borderRadius: 1,
              px: 1,
              '&:hover': { bgcolor: alphaColor(colors.accent.blue, 0.1) },
              '&.Mui-disabled': { opacity: 0.4 },
            }}
          >
            <RocketLaunchIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* ─── Error ─── */}
      {error && (
        <Box sx={{ px: 1.5, pb: 0.5 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: colors.accent.red, wordBreak: 'break-word' }}>
            ⚠ {error}
          </Typography>
        </Box>
      )}

      {/* ─── Terminal log ─── */}
      {(logs.length > 0 || scraping) && (
        <Box
          ref={logContainerRef}
          sx={{
            maxHeight: 220,
            overflowY: 'auto',
            px: 1.5,
            py: 0.75,
            bgcolor: alphaColor(colors.bg.tertiary, 0.5),
            borderTop: `1px solid ${colors.border.subtle}`,
            scrollbarWidth: 'thin',
            '&::-webkit-scrollbar': { width: 4 },
            '&::-webkit-scrollbar-thumb': { bgcolor: colors.border.default, borderRadius: 2 },
            '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
          }}
        >
          {logs.map((line) => {
            const color =
              line.kind === 'content' ? colors.text.tertiary :
              line.kind === 'error' ? colors.accent.red :
              line.kind === 'success' ? colors.accent.green :
              colors.accent.cyan;
            const prefix =
              line.kind === 'content' ? '│ ' :
              line.kind === 'error' ? '✗ ' :
              line.kind === 'success' ? '✓ ' :
              '▸ ';
            return (
              <Typography
                key={line.id}
                sx={{
                  fontFamily: MONO,
                  fontSize: '0.58rem',
                  lineHeight: 1.5,
                  color,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  opacity: line.kind === 'content' ? 0.7 : 1,
                }}
              >
                {prefix}{line.text}
              </Typography>
            );
          })}
          {scraping && logs.length === 0 && (
            <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: colors.text.dim, fontStyle: 'italic' }}>
              ▸ Initializing hybrid extractor…
            </Typography>
          )}
          <div ref={logEndRef} />
        </Box>
      )}

      {/* ─── Rescrape list ─── */}
      {urlSources.length > 0 && (
        <Box sx={{ borderTop: `1px solid ${colors.border.subtle}`, px: 1.5, py: 0.75 }}>
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: '0.55rem',
              letterSpacing: '1.2px',
              color: colors.text.dim,
              mb: 0.5,
              textTransform: 'uppercase',
            }}
          >
            URL SOURCES · RESCRAPE
          </Typography>
          {urlSources.slice(0, 10).map((source) => (
            <Box
              key={source.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                py: 0.35,
                '&:hover': { bgcolor: alphaColor(colors.bg.hover, 0.3) },
                borderRadius: 0.5,
                px: 0.5,
              }}
            >
              <Box
                sx={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  bgcolor: scrapeStatusColor(source.scrapeStatus),
                  flexShrink: 0,
                }}
              />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  sx={{
                    fontFamily: MONO,
                    fontSize: '0.58rem',
                    color: colors.text.secondary,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {source.sourceUrl}
                </Typography>
              </Box>
              <Typography
                sx={{
                  fontFamily: MONO,
                  fontSize: '0.5rem',
                  color: scrapeStatusColor(source.scrapeStatus),
                  letterSpacing: '0.8px',
                  flexShrink: 0,
                }}
              >
                {scrapeStatusLabel(source.scrapeStatus)}
              </Typography>
              <Tooltip title="Rescrape">
                <IconButton
                  size="small"
                  onClick={() => void handleRescrape(source.id)}
                  disabled={scraping}
                  sx={{
                    color: colors.text.dim,
                    p: 0.25,
                    '&:hover': { color: colors.accent.blue },
                    '&.Mui-disabled': { opacity: 0.3 },
                  }}
                >
                  <RefreshIcon sx={{ fontSize: 13 }} />
                </IconButton>
              </Tooltip>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
