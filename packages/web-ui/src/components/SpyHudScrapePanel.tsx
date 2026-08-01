// SpyHudScrapePanel — web ingestion panel with scan-then-scrape workflow.
//
// Default mode: Enter URL → click "Scrape" → root page ingested. Simple.
// Advanced mode: Expand "Reference Scan" → scan for refs → select → scrape batch.
//
// Batch scraping shows per-URL progress with pause/resume/cancel controls.

import { useCallback, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import Slider from '@mui/material/Slider';
import Checkbox from '@mui/material/Checkbox';
import Collapse from '@mui/material/Collapse';
import LinkIcon from '@mui/icons-material/Link';
import TerminalIcon from '@mui/icons-material/Terminal';
import ScanIcon from '@mui/icons-material/Radar';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DownloadIcon from '@mui/icons-material/Download';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import PendingIcon from '@mui/icons-material/Pending';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import PauseIcon from '@mui/icons-material/Pause';
import StopIcon from '@mui/icons-material/Stop';
import LinearProgress from '@mui/material/LinearProgress';
import { colors, alphaColor, MONO } from '../theme';
import type { ScannedReference, UrlScanResult, ScrapeBatchProgress, KnowledgeSource } from '@agentx/shared';

interface SpyHudScrapePanelProps {
  /** Scan a URL for references (no ingestion). */
  onScan: (url: string) => Promise<UrlScanResult>;
  /** Scrape just the root URL and ingest it. */
  onScrapeRoot: (url: string) => Promise<KnowledgeSource>;
  /** Scrape a batch of reference URLs. Returns batchId. */
  onScrapeRefs: (urls: string[], opts: { maxDepth: number; maxLinks: number }) => Promise<string>;
  /** Pause a batch scrape. */
  onPauseBatch: (batchId: string) => Promise<void>;
  /** Resume a batch scrape. */
  onResumeBatch: (batchId: string) => Promise<void>;
  /** Cancel a batch scrape. */
  onCancelBatch: (batchId: string) => Promise<void>;
  /** Batch progress events from WS, keyed by batchId. */
  batchProgress: Record<string, ScrapeBatchProgress>;
}

function isUrlValid(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

const CATEGORY_COLOR: Record<ScannedReference['category'], string> = {
  reference: colors.accent.cyan,
  pagination: colors.accent.blue,
  sequential: colors.accent.purple,
  external: colors.text.dim,
  doi: colors.accent.green,
};

const CATEGORY_LABEL: Record<ScannedReference['category'], string> = {
  reference: 'REF',
  pagination: 'PAGE',
  sequential: 'SEQ',
  external: 'EXT',
  doi: 'DOI',
};

export function SpyHudScrapePanel({
  onScan,
  onScrapeRoot,
  onScrapeRefs,
  onPauseBatch,
  onResumeBatch,
  onCancelBatch,
  batchProgress,
}: SpyHudScrapePanelProps) {
  const [urlInput, setUrlInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scrapingRoot, setScrapingRoot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<UrlScanResult | null>(null);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [maxDepth, setMaxDepth] = useState(1);
  const [maxLinks, setMaxLinks] = useState(25);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [rootScrapedMsg, setRootScrapedMsg] = useState<string | null>(null);

  // The active batch progress (if any)
  const activeProgress = activeBatchId ? batchProgress[activeBatchId] : null;
  const batchRunning = activeProgress?.status === 'running';
  const batchPaused = activeProgress?.status === 'paused';

  const handleScrapeRoot = useCallback(async () => {
    const url = urlInput.trim();
    if (!isUrlValid(url)) {
      setError('Enter a valid http(s) URL');
      return;
    }
    setError(null);
    setScrapingRoot(true);
    setRootScrapedMsg(null);
    try {
      const source = await onScrapeRoot(url);
      setRootScrapedMsg(`Scraped: ${source.name} (${source.size.toLocaleString()} bytes)`);
      setUrlInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScrapingRoot(false);
    }
  }, [urlInput, onScrapeRoot]);

  const handleScan = useCallback(async () => {
    const url = urlInput.trim();
    if (!isUrlValid(url)) {
      setError('Enter a valid http(s) URL');
      return;
    }
    setError(null);
    setScanning(true);
    setScanResult(null);
    setSelectedUrls(new Set());
    try {
      const result = await onScan(url);
      setScanResult(result);
      // Auto-select all references by default
      setSelectedUrls(new Set(result.references.map((r) => r.url)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  }, [urlInput, onScan]);

  const handleScrapeSelected = useCallback(async () => {
    if (!scanResult || selectedUrls.size === 0) return;
    setError(null);
    try {
      const batchId = await onScrapeRefs(Array.from(selectedUrls), { maxDepth, maxLinks });
      setActiveBatchId(batchId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [scanResult, selectedUrls, maxDepth, maxLinks, onScrapeRefs]);

  const toggleUrl = (url: string) => {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url); else next.add(url);
      return next;
    });
  };

  const toggleAll = () => {
    if (!scanResult) return;
    if (selectedUrls.size === scanResult.references.length) {
      setSelectedUrls(new Set());
    } else {
      setSelectedUrls(new Set(scanResult.references.map((r) => r.url)));
    }
  };

  const busy = scanning || scrapingRoot || batchRunning;

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
          WEB SCRAPE
        </Typography>
      </Box>

      {/* ─── URL input + Scrape button ─── */}
      <Box sx={{ px: 1.5, py: 1, display: 'flex', gap: 1, alignItems: 'center' }}>
        <TextField
          size="small"
          fullWidth
          placeholder="https://example.com/blog/post"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) void handleScrapeRoot();
          }}
          disabled={busy}
          sx={{
            '& .MuiInputBase-input': {
              fontFamily: MONO,
              fontSize: '0.75rem',
              color: colors.text.primary,
              py: 0.5,
              px: 1.25,
            },
            '& .MuiOutlinedInput-root': {
              height: 36,
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
        <Tooltip title="Scrape root URL and ingest">
          <IconButton
            size="small"
            onClick={() => void handleScrapeRoot()}
            disabled={busy || !urlInput.trim()}
            sx={{
              color: colors.accent.green,
              border: `1px solid ${alphaColor(colors.accent.green, 0.3)}`,
              borderRadius: 1,
              width: 36,
              height: 36,
              p: 0,
              '&:hover': { bgcolor: alphaColor(colors.accent.green, 0.1) },
              '&.Mui-disabled': { opacity: 0.4 },
            }}
          >
            <DownloadIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* ─── Root scraped confirmation ─── */}
      {rootScrapedMsg && !scrapingRoot && (
        <Box sx={{ px: 1.5, pb: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <CheckCircleIcon sx={{ fontSize: 12, color: colors.accent.green }} />
          <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: colors.accent.green }}>
            {rootScrapedMsg}
          </Typography>
        </Box>
      )}

      {/* ─── Scraping root indicator ─── */}
      {scrapingRoot && (
        <Box sx={{ px: 1.5, pb: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <PendingIcon sx={{ fontSize: 12, color: colors.accent.blue, animation: 'kbPulse 1s ease-in-out infinite' }} />
          <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: colors.accent.blue }}>
            Scraping root page…
          </Typography>
        </Box>
      )}

      {/* ─── Advanced: Reference Scan (collapsible) ─── */}
      <Box
        sx={{
          borderTop: `1px solid ${alphaColor(colors.accent.purple, 0.15)}`,
          cursor: 'pointer',
          '&:hover': { bgcolor: alphaColor(colors.accent.purple, 0.03) },
        }}
        onClick={() => !busy && setShowAdvanced((v) => !v)}
      >
        <Box sx={{ px: 1.5, py: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {showAdvanced ? (
            <ExpandLessIcon sx={{ fontSize: 14, color: colors.accent.purple }} />
          ) : (
            <ExpandMoreIcon sx={{ fontSize: 14, color: colors.accent.purple }} />
          )}
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: '0.55rem',
              letterSpacing: '1px',
              color: colors.accent.purple,
              fontWeight: 600,
              textTransform: 'uppercase',
            }}
          >
            REFERENCE SCAN
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: colors.text.dim, ml: 0.5 }}>
            (advanced)
          </Typography>
        </Box>
      </Box>

      <Collapse in={showAdvanced}>
        <Box sx={{ px: 1.5, pb: 1 }}>
          {/* Scan button row */}
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1 }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: colors.text.secondary, flex: 1 }}>
              Scan the root page to discover reference links (no ingestion)
            </Typography>
            <Tooltip title="Scan for references">
              <IconButton
                size="small"
                onClick={(e) => { e.stopPropagation(); void handleScan(); }}
                disabled={busy || !urlInput.trim()}
                sx={{
                  color: colors.accent.purple,
                  border: `1px solid ${alphaColor(colors.accent.purple, 0.3)}`,
                  borderRadius: 1,
                  height: 28,
                  px: 1,
                  '&:hover': { bgcolor: alphaColor(colors.accent.purple, 0.1) },
                  '&.Mui-disabled': { opacity: 0.4 },
                }}
              >
                <ScanIcon sx={{ fontSize: 14 }} />
                <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', ml: 0.5, fontWeight: 600 }}>SCAN</Typography>
              </IconButton>
            </Tooltip>
          </Box>

          {/* Scanning indicator */}
          {scanning && !scanResult && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
              <PendingIcon sx={{ fontSize: 12, color: colors.accent.purple, animation: 'kbPulse 1s ease-in-out infinite' }} />
              <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: colors.accent.purple }}>
                Scanning root page and discovering references…
              </Typography>
            </Box>
          )}

          {/* ─── Scan Report ─── */}
          {scanResult && (
            <Box
              sx={{
                border: `1px solid ${alphaColor(colors.accent.cyan, 0.2)}`,
                borderRadius: 1,
                bgcolor: alphaColor(colors.accent.cyan, 0.03),
                overflow: 'hidden',
              }}
            >
              {/* Scan summary */}
              <Box sx={{ px: 1, py: 0.5, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <CheckCircleIcon sx={{ fontSize: 12, color: colors.accent.green }} />
                <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: colors.accent.green, fontWeight: 600 }}>
                  SCAN COMPLETE
                </Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: colors.text.dim }}>
                  {scanResult.references.length} refs · {scanResult.contentLength.toLocaleString()} chars · {scanResult.fetchMethod}
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: colors.text.secondary, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {scanResult.title}
                </Typography>
              </Box>

              {/* Reference table */}
              {scanResult.references.length > 0 && (
                <Box sx={{ maxHeight: 200, overflowY: 'auto', borderTop: `1px solid ${colors.border.subtle}`, borderBottom: batchRunning ? 'none' : `1px solid ${colors.border.subtle}` }}>
                  {/* Header row */}
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      px: 1,
                      py: 0.5,
                      position: 'sticky',
                      top: 0,
                      bgcolor: colors.bg.tertiary,
                      borderBottom: `1px solid ${colors.border.default}`,
                      zIndex: 1,
                    }}
                  >
                    <Checkbox
                      size="small"
                      checked={selectedUrls.size === scanResult.references.length}
                      indeterminate={selectedUrls.size > 0 && selectedUrls.size < scanResult.references.length}
                      onChange={toggleAll}
                      disabled={batchRunning}
                      sx={{ p: 0.25, color: colors.accent.cyan, '&.Mui-checked': { color: colors.accent.cyan } }}
                    />
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.45rem', color: colors.text.dim, letterSpacing: 1, minWidth: 28 }}>SCORE</Typography>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.45rem', color: colors.text.dim, letterSpacing: 1, minWidth: 36 }}>TYPE</Typography>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.45rem', color: colors.text.dim, letterSpacing: 1, flex: 1 }}>URL</Typography>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.45rem', color: colors.text.dim, letterSpacing: 1, minWidth: 60 }}>HOST</Typography>
                  </Box>

                  {scanResult.references.map((ref) => {
                    const selected = selectedUrls.has(ref.url);
                    const catColor = CATEGORY_COLOR[ref.category];
                    // Check if this URL is currently being scraped in the batch
                    const isCurrent = activeProgress?.currentUrl === ref.url;
                    return (
                      <Box
                        key={ref.url}
                        onClick={() => !batchRunning && toggleUrl(ref.url)}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.5,
                          px: 1,
                          py: 0.5,
                          cursor: batchRunning ? 'default' : 'pointer',
                          borderBottom: `1px solid ${alphaColor(colors.border.subtle, 0.5)}`,
                          '&:hover': batchRunning ? {} : { bgcolor: alphaColor(colors.accent.cyan, 0.05) },
                          ...(selected ? { bgcolor: alphaColor(colors.accent.cyan, 0.04) } : {}),
                          ...(isCurrent ? { bgcolor: alphaColor(colors.accent.blue, 0.08) } : {}),
                        }}
                      >
                        <Checkbox
                          size="small"
                          checked={selected}
                          onChange={() => toggleUrl(ref.url)}
                          onClick={(e) => e.stopPropagation()}
                          disabled={batchRunning}
                          sx={{ p: 0.25, color: catColor, '&.Mui-checked': { color: catColor } }}
                        />
                        <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: colors.text.secondary, minWidth: 28, fontWeight: 600 }}>
                          {ref.score}
                        </Typography>
                        <Box sx={{ minWidth: 36 }}>
                          <Box
                            sx={{
                              display: 'inline-block',
                              px: 0.4,
                              py: 0.1,
                              borderRadius: 0.25,
                              fontSize: '0.4rem',
                              fontFamily: MONO,
                              fontWeight: 700,
                              color: catColor,
                              bgcolor: alphaColor(catColor, 0.12),
                              border: `1px solid ${alphaColor(catColor, 0.3)}`,
                            }}
                          >
                            {CATEGORY_LABEL[ref.category]}
                          </Box>
                        </Box>
                        <Typography
                          component="a"
                          href={ref.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          sx={{
                            fontFamily: MONO,
                            fontSize: '0.55rem',
                            color: isCurrent ? colors.accent.blue : selected ? colors.accent.cyan : colors.text.tertiary,
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            textDecoration: 'none',
                            '&:hover': { color: colors.accent.cyan, textDecoration: 'underline' },
                          }}
                        >
                          {ref.url}
                        </Typography>
                        {isCurrent && (
                          <PendingIcon sx={{ fontSize: 10, color: colors.accent.blue, animation: 'kbPulse 1s ease-in-out infinite' }} />
                        )}
                        <Typography sx={{ fontFamily: MONO, fontSize: '0.45rem', color: colors.text.dim, minWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {ref.host}
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>
              )}

              {/* Batch progress */}
              {activeProgress && (
                <Box sx={{ px: 1, py: 0.5, borderTop: `1px solid ${colors.border.subtle}` }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: colors.accent.blue, fontWeight: 600 }}>
                      BATCH {activeProgress.completed}/{activeProgress.total}
                    </Typography>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: colors.accent.green }}>
                      ✓{activeProgress.succeeded}
                    </Typography>
                    {activeProgress.failed > 0 && (
                      <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: colors.accent.red }}>
                        ✗{activeProgress.failed}
                      </Typography>
                    )}
                    <Box sx={{ flex: 1 }} />
                    {batchRunning && (
                      <>
                        <Tooltip title="Pause">
                          <IconButton size="small" onClick={() => void onPauseBatch(activeProgress.batchId)} sx={{ p: 0.25, color: colors.accent.orange }}>
                            <PauseIcon sx={{ fontSize: 12 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Cancel">
                          <IconButton size="small" onClick={() => void onCancelBatch(activeProgress.batchId)} sx={{ p: 0.25, color: colors.accent.red }}>
                            <StopIcon sx={{ fontSize: 12 }} />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                    {batchPaused && (
                      <Tooltip title="Resume">
                        <IconButton size="small" onClick={() => void onResumeBatch(activeProgress.batchId)} sx={{ p: 0.25, color: colors.accent.green }}>
                          <PlayArrowIcon sx={{ fontSize: 12 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={activeProgress.total > 0 ? (activeProgress.completed / activeProgress.total) * 100 : 0}
                    sx={{
                      height: 3,
                      borderRadius: 1,
                      bgcolor: colors.border.default,
                      '& .MuiLinearProgress-bar': {
                        bgcolor: activeProgress.status === 'done' ? colors.accent.green : colors.accent.blue,
                      },
                    }}
                  />
                  {activeProgress.currentUrl && activeProgress.status === 'running' && (
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.45rem', color: colors.text.dim, mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      → {activeProgress.currentUrl}
                    </Typography>
                  )}
                  {activeProgress.status === 'done' && (
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: colors.accent.green, mt: 0.25 }}>
                      Batch complete — {activeProgress.succeeded} scraped, {activeProgress.failed} failed
                    </Typography>
                  )}
                </Box>
              )}

              {/* Scrape controls (hidden while batch is running) */}
              {!activeProgress?.status || activeProgress.status === 'done' || activeProgress.status === 'paused' ? (
                <Box sx={{ px: 1, py: 0.75, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  {/* Depth & Links controls */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: colors.text.secondary, minWidth: 60, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Depth
                    </Typography>
                    <Slider
                      value={maxDepth}
                      onChange={(_, v) => setMaxDepth(Array.isArray(v) ? v[0]! : v)}
                      min={1}
                      max={10}
                      step={1}
                      disabled={selectedUrls.size === 0}
                      marks={[1, 2, 3, 5, 10].map((v) => ({ value: v, label: `${v}` }))}
                      valueLabelDisplay="auto"
                      sx={{
                        color: colors.accent.cyan,
                        flex: 1,
                        '& .MuiSlider-markLabel': { fontFamily: MONO, fontSize: '0.5rem', color: colors.text.dim },
                        '& .MuiSlider-rail': { bgcolor: colors.border.default },
                        '& .MuiSlider-valueLabel': { fontFamily: MONO, fontSize: '0.5rem', bgcolor: colors.accent.cyan },
                      }}
                    />
                    <Tooltip title="Depth = how many levels deep to follow references from each scraped page. 1 = scrape only the selected URLs. 2 = also follow references found on those pages. Etc.">
                      <Typography sx={{ fontFamily: MONO, fontSize: '0.45rem', color: colors.text.dim, cursor: 'help' }}>
                        (?)
                      </Typography>
                    </Tooltip>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: colors.text.secondary, minWidth: 60, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Links/pg
                    </Typography>
                    <Slider
                      value={maxLinks}
                      onChange={(_, v) => setMaxLinks(Array.isArray(v) ? v[0]! : v)}
                      min={1}
                      max={250}
                      step={1}
                      disabled={selectedUrls.size === 0 || maxDepth === 1}
                      valueLabelDisplay="auto"
                      sx={{
                        color: colors.accent.cyan,
                        flex: 1,
                        '& .MuiSlider-valueLabel': { fontFamily: MONO, fontSize: '0.5rem', bgcolor: colors.accent.cyan },
                        '& .MuiSlider-rail': { bgcolor: colors.border.default },
                        opacity: maxDepth === 1 ? 0.5 : 1,
                      }}
                    />
                    <Tooltip title="Max references to follow per page (only used when depth > 1). Limits how many child references each scraped page can spawn.">
                      <Typography sx={{ fontFamily: MONO, fontSize: '0.45rem', color: colors.text.dim, cursor: 'help' }}>
                        (?)
                      </Typography>
                    </Tooltip>
                  </Box>
                  {maxDepth === 1 && (
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.45rem', color: colors.text.dim }}>
                      Depth 1 = scrape only the {selectedUrls.size} selected URLs (no recursive following)
                    </Typography>
                  )}
                  {maxDepth > 1 && (
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.45rem', color: colors.accent.purple }}>
                      Depth {maxDepth}: each scraped page will also follow up to {maxLinks} of its own references
                    </Typography>
                  )}
                  {/* Action row */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.25 }}>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: colors.accent.cyan, flex: 1 }}>
                      {selectedUrls.size} of {scanResult.references.length} selected
                    </Typography>
                    <Tooltip title="Scrape selected references">
                      <IconButton
                        size="small"
                        onClick={() => void handleScrapeSelected()}
                        disabled={selectedUrls.size === 0}
                        sx={{
                          color: colors.accent.green,
                          border: `1px solid ${alphaColor(colors.accent.green, 0.4)}`,
                          borderRadius: 1,
                          height: 28,
                          px: 1,
                          '&:hover': { bgcolor: alphaColor(colors.accent.green, 0.1) },
                          '&.Mui-disabled': { opacity: 0.4 },
                        }}
                      >
                        <PlayArrowIcon sx={{ fontSize: 14 }} />
                        <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', ml: 0.5, fontWeight: 600 }}>
                          SCRAPE{selectedUrls.size > 0 ? ` (${selectedUrls.size})` : ''}
                        </Typography>
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
              ) : null}
            </Box>
          )}
        </Box>
      </Collapse>

      {/* ─── Error ─── */}
      {error && (
        <Box sx={{ px: 1.5, pb: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <ErrorIcon sx={{ fontSize: 12, color: colors.accent.red }} />
          <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: colors.accent.red, wordBreak: 'break-word' }}>
            {error}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
