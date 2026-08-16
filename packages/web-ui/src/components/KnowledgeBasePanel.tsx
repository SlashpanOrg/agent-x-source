import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualGrid } from '../perf/useVirtualGrid';
import type { KnowledgeSource, KnowledgeSourceStatus } from '@agentx/shared';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Collapse from '@mui/material/Collapse';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { PanelHeader } from './PanelHeader';
import { useKnowledgeBase } from '../hooks/useKnowledgeBase';
import { knowledgeBase, neuralCortex } from '../api';
import { colors, alphaColor, MONO } from '../theme';
import { SpyHudScrapePanel } from './SpyHudScrapePanel';

import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import StorageIcon from '@mui/icons-material/Storage';
import DescriptionIcon from '@mui/icons-material/Description';
import LayersIcon from '@mui/icons-material/Layers';
import DataObjectIcon from '@mui/icons-material/DataObject';
import CloseIcon from '@mui/icons-material/Close';
import ReplayIcon from '@mui/icons-material/Replay';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import SubdirectoryArrowRightIcon from '@mui/icons-material/SubdirectoryArrowRight';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import BoltIcon from '@mui/icons-material/Bolt';
import PendingIcon from '@mui/icons-material/Pending';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import LinkIcon from '@mui/icons-material/Link';
import HubIcon from '@mui/icons-material/Hub';
import { FileViewerModal } from './FileViewerModal';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import { errorNeedsOcrInstall, OcrStackInstallButton } from './OcrStackInstallButton';

const ACCEPTED_EXTS = '.pdf,.docx,.xlsx,.pptx,.txt,.md,.json,.html,.htm';

const PIPELINE: { key: string; label: string; code: string; matches: KnowledgeSourceStatus[] }[] = [
  { key: 'queue', label: 'QUEUE', code: '01', matches: ['pending'] },
  { key: 'extract', label: 'EXTRACT', code: '02', matches: ['extracting'] },
  { key: 'chunk', label: 'CHUNK', code: '03', matches: ['chunking'] },
  { key: 'embed', label: 'EMBED', code: '04', matches: ['embedding'] },
  { key: 'index', label: 'INDEX', code: '05', matches: ['indexing', 'graphing'] },
  { key: 'ready', label: 'READY', code: '06', matches: ['ready'] },
];

/** Map API status onto the nearest visible pipeline node. */
function pipelineIndex(status: KnowledgeSourceStatus): number {
  if (status === 'failed') return -1;
  return PIPELINE.findIndex((s) => s.matches.includes(status));
}

const STATUS_COLOR: Record<string, string> = {
  pending: colors.accent.orange,
  extracting: colors.accent.blue,
  chunking: colors.accent.cyan,
  embedding: colors.accent.purple,
  indexing: colors.accent.purple,
  graphing: colors.accent.blue,
  ready: colors.accent.green,
  failed: colors.accent.red,
  processing: colors.accent.blue,
};

function formatBytes(bytes?: number): string {
  if (bytes == null || Number.isNaN(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function mimeKind(mime?: string): string {
  if (!mime) return 'FILE';
  if (mime.includes('pdf')) return 'PDF';
  if (mime.includes('word') || mime.includes('docx')) return 'DOCX';
  if (mime.includes('sheet') || mime.includes('xlsx')) return 'XLSX';
  if (mime.includes('presentation') || mime.includes('pptx')) return 'PPTX';
  if (mime.includes('json')) return 'JSON';
  if (mime.includes('html')) return 'HTML';
  if (mime.includes('markdown') || mime.includes('md')) return 'MD';
  if (mime.startsWith('text/')) return 'TXT';
  return mime.split('/').pop()?.toUpperCase() ?? 'FILE';
}

function truncateError(message: string, max = 220): string {
  const compact = message.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max)}…`;
}

function statusColor(status: string): string {
  return STATUS_COLOR[status] ?? colors.accent.blue;
}

function isActiveStatus(status: string): boolean {
  return status !== 'ready' && status !== 'failed';
}

function formatIngestStatus(source: KnowledgeSource, detail?: string): string {
  if (source.status === 'ready') return detail ?? 'Intel package indexed and online.';
  if (source.status === 'failed') return source.error ?? detail ?? 'Ingest failed.';
  if (detail) return detail;
  const stage = PIPELINE.find((p) => p.matches.includes(source.status))?.label ?? 'PROCESSING';
  return `${stage} in progress…`;
}

// ─── Shared tactical primitives ───

function Bracket({ position, color }: { position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'; color: string }) {
  const sz = 10;
  const common: React.CSSProperties = { position: 'absolute', width: sz, height: sz, borderColor: color, pointerEvents: 'none' };
  const map: Record<string, React.CSSProperties> = {
    'top-left': { top: -1, left: -1, borderTop: `2px solid ${color}`, borderLeft: `2px solid ${color}` },
    'top-right': { top: -1, right: -1, borderTop: `2px solid ${color}`, borderRight: `2px solid ${color}` },
    'bottom-left': { bottom: -1, left: -1, borderBottom: `2px solid ${color}`, borderLeft: `2px solid ${color}` },
    'bottom-right': { bottom: -1, right: -1, borderBottom: `2px solid ${color}`, borderRight: `2px solid ${color}` },
  };
  return <Box sx={{ ...common, ...map[position] }} />;
}

function SectionHeader({ label, count, trailing }: { label: string; count?: number; trailing?: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
      <Box sx={{ width: 3, height: 12, bgcolor: colors.accent.blue }} />
      <Typography sx={{ fontSize: '0.65rem', color: colors.text.secondary, fontFamily: MONO, letterSpacing: 2, fontWeight: 600 }}>
        {label}
      </Typography>
      {count != null && (
        <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, fontFamily: MONO }}>
          [{String(count).padStart(2, '0')}]
        </Typography>
      )}
      <Box sx={{ flex: 1, height: 1, background: `repeating-linear-gradient(90deg, ${colors.border.subtle} 0 8px, transparent 8px 16px)` }} />
      {trailing}
    </Box>
  );
}

function Gauge({
  icon,
  label,
  value,
  unit,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  color: string;
}) {
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        p: 0.75,
        borderRadius: 0.5,
        border: `1px solid ${colors.border.default}`,
        bgcolor: colors.bg.tertiary,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25, color }}>
        {icon}
        <Typography sx={{ fontSize: '0.48rem', color: colors.text.dim, fontFamily: MONO, letterSpacing: 1 }}>
          {label}
        </Typography>
      </Box>
      <Typography sx={{ fontSize: '0.78rem', color, fontFamily: MONO, fontWeight: 700, lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
        {unit ? (
          <Box component="span" sx={{ fontSize: '0.5rem', color: colors.text.dim, ml: 0.25, fontWeight: 400 }}>
            {unit}
          </Box>
        ) : null}
      </Typography>
    </Box>
  );
}

function TacticalDropZone({ dragOver, onClick }: { dragOver: boolean; onClick: () => void }) {
  const accent = dragOver ? colors.accent.blue : colors.border.strong;
  return (
    <Box
      onClick={onClick}
      sx={{
        position: 'relative',
        border: `1px solid ${accent}`,
        borderRadius: 0.5,
        p: 3,
        textAlign: 'center',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        bgcolor: dragOver ? alphaColor(colors.accent.blue, 0.08) : colors.bg.tertiary,
        overflow: 'hidden',
        '&:hover': { borderColor: alphaColor(colors.accent.blue, 0.5), bgcolor: alphaColor(colors.accent.blue, 0.04) },
      }}
    >
      <Bracket position="top-left" color={accent} />
      <Bracket position="top-right" color={accent} />
      <Bracket position="bottom-left" color={accent} />
      <Bracket position="bottom-right" color={accent} />

      {dragOver && (
        <Box
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: '40%',
            background: `linear-gradient(180deg, ${alphaColor(colors.accent.blue, 0.15)}, transparent)`,
            animation: 'kbScan 1.4s linear infinite',
            pointerEvents: 'none',
          }}
        />
      )}

      <CloudUploadIcon
        sx={{
          fontSize: 36,
          color: dragOver ? colors.accent.blue : colors.text.dim,
          mb: 1,
          transition: 'color 0.2s',
          ...(dragOver ? { animation: 'kbPulse 1.2s ease-in-out infinite' } : {}),
        }}
      />
      <Typography
        sx={{
          fontSize: '0.78rem',
          color: dragOver ? colors.accent.blue : colors.text.secondary,
          fontFamily: MONO,
          letterSpacing: 2,
          mb: 0.5,
          fontWeight: 600,
        }}
      >
        {dragOver ? 'RELEASE TO UPLINK' : 'DROP INTEL PACKAGES // CLICK TO SELECT'}
      </Typography>
      <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, fontFamily: MONO, letterSpacing: 1 }}>
        PDF · DOCX · XLSX · PPTX · TXT · MD · JSON · HTML
      </Typography>
    </Box>
  );
}

function StagePipeline({ source }: { source: KnowledgeSource }) {
  const failed = source.status === 'failed';
  const ready = source.status === 'ready';
  const activeIdx = ready ? PIPELINE.length - 1 : pipelineIndex(source.status);
  // When failed, light the last progressed node from progress %, else the middle.
  const failedIdx = failed
    ? Math.min(PIPELINE.length - 2, Math.max(0, Math.round(((source.progress ?? 0) / 100) * (PIPELINE.length - 2))))
    : -1;

  return (
    <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 0.5 }}>
      {PIPELINE.map((stage, i) => {
        const isCurrent = !ready && !failed && i === activeIdx;
        const isComplete = ready || (!failed && activeIdx !== -1 && i < activeIdx);
        const isFailedHere = failed && i === failedIdx;
        const color = isFailedHere
          ? colors.accent.red
          : isComplete
            ? colors.accent.green
            : isCurrent
              ? statusColor(source.status)
              : colors.text.dim;

        return (
          <Box key={stage.key} sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <Box
              sx={{
                position: 'relative',
                border: `1px solid ${isCurrent || isComplete || isFailedHere ? alphaColor(color, 0.6) : colors.border.default}`,
                borderRadius: 0.5,
                p: 0.75,
                minHeight: 54,
                display: 'flex',
                flexDirection: 'column',
                bgcolor: isCurrent || isFailedHere ? alphaColor(color, 0.08) : isComplete ? alphaColor(color, 0.06) : colors.bg.tertiary,
                ...(isCurrent ? { boxShadow: `0 0 12px ${alphaColor(color, 0.25)}` } : {}),
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.25 }}>
                <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: MONO }}>{stage.code}</Typography>
                <Box
                  sx={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    bgcolor: color,
                    ...(isCurrent ? { animation: 'kbPulse 1s ease-in-out infinite' } : {}),
                  }}
                />
              </Box>
              <Typography
                sx={{
                  fontSize: '0.55rem',
                  color,
                  fontFamily: MONO,
                  fontWeight: 600,
                  letterSpacing: 1,
                  textAlign: 'center',
                }}
              >
                {stage.label}
              </Typography>
              {stage.key === 'queue' && source.status === 'pending' && source.queuePosition != null && (
                <Typography
                  sx={{
                    fontSize: '0.48rem',
                    color,
                    fontFamily: MONO,
                    letterSpacing: 0.5,
                    textAlign: 'center',
                    mt: 0.25,
                  }}
                >
                  #{source.queuePosition}
                </Typography>
              )}
            </Box>
            {i < PIPELINE.length - 1 && (
              <Box
                sx={{
                  height: 1,
                  mt: 0.5,
                  background: `repeating-linear-gradient(90deg, ${colors.border.default} 0 4px, transparent 4px 8px)`,
                }}
              />
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function DossierMonitor({
  source,
  statusDetail,
  onClose,
  onReprocess,
  onDelete,
}: {
  source: KnowledgeSource;
  statusDetail?: string;
  onClose: () => void;
  onReprocess: () => void;
  onDelete: () => void;
}) {
  const active = isActiveStatus(source.status);
  const failed = source.status === 'failed';
  const ready = source.status === 'ready';
  const accent = statusColor(source.status);
  const [seedDetail, setSeedDetail] = useState<string | undefined>();

  useEffect(() => {
    setSeedDetail(undefined);
    let cancelled = false;
    void knowledgeBase
      .events(source.id)
      .then((events) => {
        const latest = events.at(-1);
        if (!cancelled && latest?.detail) setSeedDetail(latest.detail);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [source.id]);

  const statusLine = formatIngestStatus(source, statusDetail ?? seedDetail);

  return (
    <Box
      sx={{
        position: 'relative',
        border: `1px solid ${alphaColor(accent, 0.4)}`,
        borderRadius: 0.5,
        bgcolor: colors.bg.secondary,
        overflow: 'hidden',
      }}
    >
      <Bracket position="top-left" color={accent} />
      <Bracket position="top-right" color={accent} />
      <Bracket position="bottom-left" color={accent} />
      <Bracket position="bottom-right" color={accent} />

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          borderBottom: `1px solid ${colors.border.default}`,
          bgcolor: colors.bg.tertiary,
        }}
      >
        <Box
          sx={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            bgcolor: accent,
            flexShrink: 0,
            ...(active ? { animation: 'kbPulse 1s ease-in-out infinite' } : {}),
          }}
        />
        <Typography
          sx={{
            fontSize: '0.7rem',
            color: colors.text.primary,
            fontFamily: MONO,
            fontWeight: 600,
            letterSpacing: 1,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {source.name}
        </Typography>
        <Chip
          size="small"
          label={mimeKind(source.mimeType)}
          sx={{
            fontSize: '0.5rem',
            height: 16,
            fontFamily: MONO,
            color: colors.accent.cyan,
            bgcolor: alphaColor(colors.accent.cyan, 0.12),
            border: `1px solid ${alphaColor(colors.accent.cyan, 0.3)}`,
          }}
        />
        <Chip
          size="small"
          label={source.status.toUpperCase()}
          sx={{
            fontSize: '0.5rem',
            height: 16,
            fontFamily: MONO,
            color: accent,
            bgcolor: alphaColor(accent, 0.12),
            border: `1px solid ${alphaColor(accent, 0.3)}`,
          }}
        />
        <Tooltip title="Reprocess">
          <IconButton size="small" onClick={onReprocess} sx={{ color: colors.text.dim, p: 0.25, '&:hover': { color: colors.accent.blue } }}>
            <ReplayIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete source">
          <IconButton size="small" onClick={onDelete} sx={{ color: colors.text.dim, p: 0.25, '&:hover': { color: colors.accent.red } }}>
            <DeleteOutlineIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Close dossier">
          <IconButton size="small" onClick={onClose} sx={{ color: colors.text.dim, p: 0.25 }}>
            <CloseIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <StagePipeline source={source} />

        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, fontFamily: MONO, letterSpacing: 1 }}>
              INGEST PROGRESS
            </Typography>
            <Typography sx={{ fontSize: '0.6rem', color: accent, fontFamily: MONO, fontWeight: 600 }}>
              {ready ? 100 : failed ? 'ERR' : `${Math.max(0, Math.min(100, source.progress ?? 0))}%`}
            </Typography>
          </Box>
          <Box
            sx={{
              height: 6,
              borderRadius: 1,
              bgcolor: colors.border.subtle,
              overflow: 'hidden',
              border: `1px solid ${colors.border.default}`,
            }}
          >
            <Box
              sx={{
                height: '100%',
                width: `${ready ? 100 : failed ? 100 : Math.max(0, Math.min(100, source.progress ?? 0))}%`,
                bgcolor: accent,
                transition: 'width 0.4s ease',
                ...(active
                  ? {
                      backgroundImage: `repeating-linear-gradient(45deg, ${accent} 0 8px, ${alphaColor(accent, 0.8)} 8px 16px)`,
                      backgroundSize: '16px 16px',
                      animation: 'kbMarch 0.6s linear infinite',
                    }
                  : {}),
              }}
            />
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Gauge icon={<StorageIcon sx={{ fontSize: 13 }} />} label="SIZE" value={formatBytes(source.size)} color={colors.accent.blue} />
          <Gauge icon={<DescriptionIcon sx={{ fontSize: 13 }} />} label="PAGES" value={String(source.pageCount ?? '—')} color={colors.accent.cyan} />
          <Gauge icon={<LayersIcon sx={{ fontSize: 13 }} />} label="CHUNKS" value={String(source.chunkCount ?? '—')} color={colors.accent.purple} />
          <Gauge icon={<DataObjectIcon sx={{ fontSize: 13 }} />} label="MIME" value={mimeKind(source.mimeType)} color={colors.accent.orange} />
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
          <Box sx={{ p: 0.75, border: `1px solid ${colors.border.default}`, borderRadius: 0.5, bgcolor: colors.bg.tertiary }}>
            <Typography sx={{ fontSize: '0.48rem', color: colors.text.dim, fontFamily: MONO, letterSpacing: 1, mb: 0.25 }}>
              CREATED
            </Typography>
            <Typography sx={{ fontSize: '0.65rem', color: colors.text.secondary, fontFamily: MONO }}>
              {formatDate(source.createdAt)}
            </Typography>
          </Box>
          <Box sx={{ p: 0.75, border: `1px solid ${colors.border.default}`, borderRadius: 0.5, bgcolor: colors.bg.tertiary }}>
            <Typography sx={{ fontSize: '0.48rem', color: colors.text.dim, fontFamily: MONO, letterSpacing: 1, mb: 0.25 }}>
              UPDATED
            </Typography>
            <Typography sx={{ fontSize: '0.65rem', color: colors.text.secondary, fontFamily: MONO }}>
              {formatDate(source.updatedAt)}
            </Typography>
          </Box>
        </Box>

        {source.error && (
          <Box
            sx={{
              p: 1,
              border: `1px solid ${alphaColor(colors.accent.red, 0.35)}`,
              borderRadius: 0.5,
              bgcolor: alphaColor(colors.accent.red, 0.06),
            }}
          >
            <Typography sx={{ fontSize: '0.5rem', color: colors.accent.red, fontFamily: MONO, letterSpacing: 1.5, mb: 0.5 }}>
              FAULT REPORT
            </Typography>
            <Typography
              sx={{
                fontSize: '0.65rem',
                color: colors.accent.red,
                fontFamily: MONO,
                lineHeight: 1.45,
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
              }}
              title={source.error}
            >
              {truncateError(source.error)}
            </Typography>
            {failed && errorNeedsOcrInstall(source.error) && (
              <OcrStackInstallButton compact onInstalled={onReprocess} />
            )}
          </Box>
        )}

        {source.summary && (
          <Box>
            <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: MONO, letterSpacing: 1.5, mb: 0.5 }}>
              INTEL BRIEF
            </Typography>
            <Box
              sx={{
                p: 1,
                border: `1px solid ${colors.border.default}`,
                borderRadius: 0.5,
                bgcolor: colors.bg.primary,
                maxHeight: 160,
                overflow: 'auto',
              }}
            >
              <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary, fontFamily: MONO, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {source.summary}
              </Typography>
            </Box>
          </Box>
        )}

        <Box>
          <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: MONO, letterSpacing: 1.5, mb: 0.5 }}>
            INGEST STATUS
          </Typography>
          <Box
            sx={{
              p: 1,
              border: `1px solid ${colors.border.default}`,
              borderRadius: 0.5,
              bgcolor: colors.bg.primary,
              minHeight: 40,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <Typography
              sx={{
                fontSize: '0.68rem',
                color: failed ? colors.accent.red : ready ? colors.accent.green : colors.text.secondary,
                fontFamily: MONO,
                lineHeight: 1.45,
                wordBreak: 'break-word',
              }}
            >
              {active && (
                <Box
                  component="span"
                  sx={{
                    display: 'inline-block',
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    bgcolor: accent,
                    mr: 0.75,
                    verticalAlign: 'middle',
                    animation: 'kbPulse 1s ease-in-out infinite',
                  }}
                />
              )}
              {statusLine}
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function UrlScrapeDossier({
  source,
  statusDetail,
  children,
  cumulative,
  onClose,
  onReprocess,
  onDelete,
  onPause,
  onResume,
}: {
  source: KnowledgeSource;
  statusDetail?: string;
  children: KnowledgeSource[];
  cumulative?: { size: number; pageCount: number; chunkCount: number };
  onClose: () => void;
  onReprocess: () => void;
  onDelete: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const active = isActiveStatus(source.status);
  const failed = source.status === 'failed';
  const ready = source.status === 'ready';
  const paused = source.scrapeStatus === 'paused';
  const accent = paused ? colors.accent.orange : statusColor(source.status);
  const [seedDetail, setSeedDetail] = useState<string | undefined>();

  useEffect(() => {
    setSeedDetail(undefined);
    let cancelled = false;
    void knowledgeBase
      .events(source.id)
      .then((events) => {
        const latest = events.at(-1);
        if (!cancelled && latest?.detail) setSeedDetail(latest.detail);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [source.id]);

  const statusLine = formatIngestStatus(source, statusDetail ?? seedDetail);
  const childRefs = children.filter((c) => c.sourceUrl);

  return (
    <Box
      sx={{
        position: 'relative',
        border: `1px solid ${alphaColor(colors.accent.cyan, 0.4)}`,
        borderRadius: 0.5,
        bgcolor: colors.bg.secondary,
        overflow: 'hidden',
      }}
    >
      <Bracket position="top-left" color={colors.accent.cyan} />
      <Bracket position="top-right" color={colors.accent.cyan} />
      <Bracket position="bottom-left" color={colors.accent.cyan} />
      <Bracket position="bottom-right" color={colors.accent.cyan} />

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          borderBottom: `1px solid ${colors.border.default}`,
          bgcolor: alphaColor(colors.accent.cyan, 0.08),
        }}
      >
        <Box
          sx={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            bgcolor: accent,
            flexShrink: 0,
            ...(active ? { animation: 'kbPulse 1s ease-in-out infinite' } : {}),
          }}
        />
        <LinkIcon sx={{ fontSize: 14, color: colors.accent.cyan, flexShrink: 0 }} />
        <Typography
          sx={{
            fontSize: '0.7rem',
            color: colors.text.primary,
            fontFamily: MONO,
            fontWeight: 600,
            letterSpacing: 1,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {source.name}
        </Typography>
        <Chip
          size="small"
          label="WEB"
          sx={{
            fontSize: '0.5rem',
            height: 16,
            fontFamily: MONO,
            color: colors.accent.cyan,
            bgcolor: alphaColor(colors.accent.cyan, 0.12),
            border: `1px solid ${alphaColor(colors.accent.cyan, 0.3)}`,
          }}
        />
        <Chip
          size="small"
          label={source.status.toUpperCase()}
          sx={{
            fontSize: '0.5rem',
            height: 16,
            fontFamily: MONO,
            color: accent,
            bgcolor: alphaColor(accent, 0.12),
            border: `1px solid ${alphaColor(accent, 0.3)}`,
          }}
        />
        {source.scrapeStatus && (
          <Chip
            size="small"
            label={source.scrapeStatus.toUpperCase()}
            sx={{
              fontSize: '0.5rem',
              height: 16,
              fontFamily: MONO,
              color: source.scrapeStatus === 'paused' ? colors.accent.orange : colors.text.dim,
              bgcolor: alphaColor(source.scrapeStatus === 'paused' ? colors.accent.orange : colors.text.dim, 0.12),
              border: `1px solid ${alphaColor(source.scrapeStatus === 'paused' ? colors.accent.orange : colors.text.dim, 0.3)}`,
            }}
          />
        )}
        <Tooltip title="Rescrape">
          <IconButton size="small" onClick={onReprocess} sx={{ color: colors.text.dim, p: 0.25, '&:hover': { color: colors.accent.blue } }}>
            <ReplayIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
        {paused ? (
          <Tooltip title="Resume follow queue">
            <IconButton size="small" onClick={onResume} sx={{ color: colors.accent.green, p: 0.25, '&:hover': { color: colors.accent.green } }}>
              <PlayArrowIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        ) : (
          <Tooltip title="Pause follow queue">
            <IconButton size="small" onClick={onPause} sx={{ color: colors.text.dim, p: 0.25, '&:hover': { color: colors.accent.orange } }}>
              <PauseIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="Delete source">
          <IconButton size="small" onClick={onDelete} sx={{ color: colors.text.dim, p: 0.25, '&:hover': { color: colors.accent.red } }}>
            <DeleteOutlineIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Close dossier">
          <IconButton size="small" onClick={onClose} sx={{ color: colors.text.dim, p: 0.25 }}>
            <CloseIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <StagePipeline source={source} />

        {source.sourceUrl && (
          <Box
            sx={{
              p: 0.75,
              border: `1px solid ${alphaColor(colors.accent.cyan, 0.25)}`,
              borderRadius: 0.5,
              bgcolor: alphaColor(colors.accent.cyan, 0.04),
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
            }}
          >
            <LinkIcon sx={{ fontSize: 13, color: colors.accent.cyan }} />
            <Typography
              component="a"
              href={source.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                fontSize: '0.65rem',
                color: colors.accent.cyan,
                fontFamily: MONO,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                textDecoration: 'none',
                '&:hover': { textDecoration: 'underline' },
              }}
            >
              {source.sourceUrl}
            </Typography>
          </Box>
        )}

        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, fontFamily: MONO, letterSpacing: 1 }}>
              SCRAPE PROGRESS
            </Typography>
            <Typography sx={{ fontSize: '0.6rem', color: accent, fontFamily: MONO, fontWeight: 600 }}>
              {ready ? 100 : failed ? 'ERR' : `${Math.max(0, Math.min(100, source.progress ?? 0))}%`}
            </Typography>
          </Box>
          <Box
            sx={{
              height: 6,
              borderRadius: 1,
              bgcolor: colors.border.subtle,
              overflow: 'hidden',
              border: `1px solid ${colors.border.default}`,
            }}
          >
            <Box
              sx={{
                height: '100%',
                width: `${ready ? 100 : failed ? 100 : Math.max(0, Math.min(100, source.progress ?? 0))}%`,
                bgcolor: accent,
                transition: 'width 0.4s ease',
                ...(active
                  ? {
                      backgroundImage: `repeating-linear-gradient(45deg, ${accent} 0 8px, ${alphaColor(accent, 0.8)} 8px 16px)`,
                      backgroundSize: '16px 16px',
                      animation: 'kbMarch 0.6s linear infinite',
                    }
                  : {}),
              }}
            />
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Gauge icon={<StorageIcon sx={{ fontSize: 13 }} />} label="SIZE" value={formatBytes(cumulative?.size ?? source.size)} color={colors.accent.blue} />
          <Gauge icon={<DescriptionIcon sx={{ fontSize: 13 }} />} label="PAGES" value={String(cumulative?.pageCount ?? source.pageCount ?? '—')} color={colors.accent.cyan} />
          <Gauge icon={<LayersIcon sx={{ fontSize: 13 }} />} label="CHUNKS" value={String(cumulative?.chunkCount ?? source.chunkCount ?? '—')} color={colors.accent.purple} />
          <Gauge icon={<HubIcon sx={{ fontSize: 13 }} />} label="REFS" value={String(childRefs.length)} color={colors.accent.cyan} />
        </Box>

        {childRefs.length > 0 && (
          <Box>
            <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: MONO, letterSpacing: 1.5, mb: 0.5 }}>
              REFERENCE LINKS
            </Typography>
            <Box
              sx={{
                border: `1px solid ${colors.border.default}`,
                borderRadius: 0.5,
                bgcolor: colors.bg.primary,
                maxHeight: 160,
                overflow: 'auto',
              }}
            >
              {childRefs.map((child) => (
                <Box
                  key={child.id}
                  sx={{
                    px: 1,
                    py: 0.6,
                    borderBottom: `1px solid ${colors.border.default}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.75,
                    '&:last-child': { borderBottom: 0 },
                  }}
                >
                  <SubdirectoryArrowRightIcon sx={{ fontSize: 12, color: colors.accent.cyan }} />
                  <Typography
                    component="a"
                    href={child.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{
                      fontSize: '0.6rem',
                      color: colors.text.secondary,
                      fontFamily: MONO,
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      textDecoration: 'none',
                      '&:hover': { color: colors.accent.cyan, textDecoration: 'underline' },
                    }}
                  >
                    {child.name || child.sourceUrl}
                  </Typography>
                  <Chip
                    size="small"
                    label={child.status.toUpperCase()}
                    sx={{
                      fontSize: '0.45rem',
                      height: 14,
                      fontFamily: MONO,
                      color: statusColor(child.status),
                      bgcolor: alphaColor(statusColor(child.status), 0.1),
                      border: `1px solid ${alphaColor(statusColor(child.status), 0.3)}`,
                    }}
                  />
                </Box>
              ))}
            </Box>
          </Box>
        )}

        {source.error && (
          <Box
            sx={{
              p: 1,
              border: `1px solid ${alphaColor(colors.accent.red, 0.35)}`,
              borderRadius: 0.5,
              bgcolor: alphaColor(colors.accent.red, 0.06),
            }}
          >
            <Typography sx={{ fontSize: '0.5rem', color: colors.accent.red, fontFamily: MONO, letterSpacing: 1.5, mb: 0.5 }}>
              FAULT REPORT
            </Typography>
            <Typography
              sx={{
                fontSize: '0.65rem',
                color: colors.accent.red,
                fontFamily: MONO,
                lineHeight: 1.45,
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
              }}
              title={source.error}
            >
              {truncateError(source.error)}
            </Typography>
          </Box>
        )}

        {source.summary && (
          <Box>
            <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: MONO, letterSpacing: 1.5, mb: 0.5 }}>
              INTEL BRIEF
            </Typography>
            <Box
              sx={{
                p: 1,
                border: `1px solid ${colors.border.default}`,
                borderRadius: 0.5,
                bgcolor: colors.bg.primary,
                maxHeight: 160,
                overflow: 'auto',
              }}
            >
              <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary, fontFamily: MONO, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {source.summary}
              </Typography>
            </Box>
          </Box>
        )}

        <Box>
          <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: MONO, letterSpacing: 1.5, mb: 0.5 }}>
            INGEST STATUS
          </Typography>
          <Box
            sx={{
              p: 1,
              border: `1px solid ${colors.border.default}`,
              borderRadius: 0.5,
              bgcolor: colors.bg.primary,
              minHeight: 40,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <Typography
              sx={{
                fontSize: '0.68rem',
                color: failed ? colors.accent.red : ready ? colors.accent.green : colors.text.secondary,
                fontFamily: MONO,
                lineHeight: 1.45,
                wordBreak: 'break-word',
              }}
            >
              {active && (
                <Box
                  component="span"
                  sx={{
                    display: 'inline-block',
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    bgcolor: accent,
                    mr: 0.75,
                    verticalAlign: 'middle',
                    animation: 'kbPulse 1s ease-in-out infinite',
                  }}
                />
              )}
              {statusLine}
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function SourceCard({
  source,
  selected,
  onSelect,
  onView,
  onReprocess,
  onDelete,
  depth = 0,
  childCount,
  expanded,
  onToggle,
  totals,
}: {
  source: KnowledgeSource;
  selected: boolean;
  onSelect: () => void;
  onView: () => void;
  onReprocess: () => void;
  onDelete: () => void;
  depth?: number;
  childCount?: number;
  expanded?: boolean;
  onToggle?: () => void;
  totals?: { size: number; pageCount: number; chunkCount: number };
}) {
  const accent = statusColor(source.status);
  const active = isActiveStatus(source.status);
  const failed = source.status === 'failed';
  const ready = source.status === 'ready';
  const StageIcon = ready ? CheckCircleIcon : failed ? ErrorIcon : active ? BoltIcon : PendingIcon;

  const isChild = depth > 0;
  const canExpand = childCount !== undefined && childCount > 0;

  return (
    <Box
      onClick={onSelect}
      sx={{
        p: 1.1,
        pl: isChild ? 1.1 : 1.1,
        borderRadius: 0.5,
        cursor: 'pointer',
        border: `1px solid ${selected ? alphaColor(accent, 0.6) : colors.border.default}`,
        bgcolor: selected ? alphaColor(accent, 0.06) : colors.bg.tertiary,
        transition: 'border-color 0.15s, background-color 0.15s',
        ml: isChild ? 1.5 : 0,
        borderLeft: isChild ? `2px solid ${alphaColor(colors.accent.cyan, 0.5)}` : undefined,
        borderTopLeftRadius: isChild ? 0 : 0.5,
        borderBottomLeftRadius: isChild ? 0 : 0.5,
        '&:hover': { borderColor: colors.border.strong },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.6 }}>
        {canExpand && (
          <Tooltip title={expanded ? 'Collapse references' : `Expand ${childCount} reference${childCount === 1 ? '' : 's'}`}>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onToggle?.();
              }}
              sx={{ color: colors.text.dim, p: 0.15, '&:hover': { color: colors.accent.cyan } }}
            >
              {expanded ? <ExpandMoreIcon sx={{ fontSize: 14 }} /> : <ChevronRightIcon sx={{ fontSize: 14 }} />}
            </IconButton>
          </Tooltip>
        )}
        <StageIcon
          sx={{
            fontSize: 14,
            color: accent,
            flexShrink: 0,
            ...(active ? { animation: 'kbPulse 1.5s ease-in-out infinite' } : {}),
          }}
        />
        {source.sourceUrl ? (
          isChild ? (
            <SubdirectoryArrowRightIcon sx={{ fontSize: 14, color: colors.accent.cyan, flexShrink: 0 }} titleAccess="Followed reference" />
          ) : (
            <LinkIcon sx={{ fontSize: 14, color: colors.accent.blue, flexShrink: 0 }} titleAccess="Web link" />
          )
        ) : (
          <DescriptionIcon sx={{ fontSize: 14, color: colors.text.dim, flexShrink: 0 }} titleAccess="Document" />
        )}
        <Typography
          sx={{
            fontSize: '0.7rem',
            color: colors.text.primary,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: MONO,
          }}
        >
          {source.name}
        </Typography>
        <Chip
          size="small"
          label={mimeKind(source.mimeType)}
          sx={{
            fontSize: '0.48rem',
            height: 16,
            fontFamily: MONO,
            color: colors.text.dim,
            bgcolor: 'transparent',
            border: `1px solid ${colors.border.default}`,
          }}
        />
        {canExpand && (
          <Chip
            size="small"
            label={`${childCount} ref${childCount === 1 ? '' : 's'}`}
            sx={{
              fontSize: '0.48rem',
              height: 16,
              fontFamily: MONO,
              color: colors.accent.cyan,
              bgcolor: alphaColor(colors.accent.cyan, 0.08),
              border: `1px solid ${alphaColor(colors.accent.cyan, 0.4)}`,
            }}
          />
        )}
        <Typography sx={{ fontSize: '0.55rem', color: accent, fontFamily: MONO, fontWeight: 600, letterSpacing: 0.5 }}>
          {source.status.toUpperCase()}
        </Typography>
        <Tooltip title="View file">
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onView();
            }}
            sx={{ color: colors.text.dim, p: 0.2, '&:hover': { color: colors.accent.cyan } }}
          >
            <VisibilityOutlinedIcon sx={{ fontSize: 13 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Reprocess">
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onReprocess();
            }}
            sx={{ color: colors.text.dim, p: 0.2, '&:hover': { color: colors.accent.blue } }}
          >
            <ReplayIcon sx={{ fontSize: 13 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete">
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            sx={{ color: colors.text.dim, p: 0.2, '&:hover': { color: colors.accent.red } }}
          >
            <DeleteOutlineIcon sx={{ fontSize: 13 }} />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ height: 2, borderRadius: 1, bgcolor: colors.border.subtle, overflow: 'hidden', mb: 0.4 }}>
        <Box
          sx={{
            height: '100%',
            width: `${ready ? 100 : failed ? 100 : Math.max(4, Math.min(100, source.progress ?? 0))}%`,
            bgcolor: accent,
            transition: 'width 0.4s ease',
          }}
        />
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ fontSize: '0.52rem', color: colors.text.dim, fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {formatBytes(totals?.size ?? source.size)} · {(totals?.pageCount ?? source.pageCount ?? 0)} PG · {(totals?.chunkCount ?? source.chunkCount ?? 0)} CHK
        </Typography>
        <Typography sx={{ fontSize: '0.52rem', color: colors.text.dim, fontFamily: MONO, flexShrink: 0 }}>
          {formatDate(source.updatedAt)}
        </Typography>
      </Box>
    </Box>
  );
}

// ─── Main Panel ───

export function KnowledgeBasePanel() {
  const {
    sources,
    loading,
    error,
    ingestDetails,
    batchProgress,
    refresh,
    upload,
    deleteSource,
    reprocess,
    scrape,
    scan,
    scrapeRefs,
    pauseBatch,
    resumeBatch,
    cancelBatch,
    rescrape,
    pause,
    resume,
  } = useKnowledgeBase();
  const [dragOver, setDragOver] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ id: string; name: string; mimeType?: string } | null>(null);
  const [cortexDegraded, setCortexDegraded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const vaultScrollRef = useRef<HTMLDivElement>(null);
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  const [deletePending, setDeletePending] = useState<{ id: string; name: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const requestDeleteSource = (id: string, name: string) => setDeletePending({ id, name });

  const confirmDeleteSource = async () => {
    if (!deletePending) return;
    setDeleteBusy(true);
    try {
      await deleteSource(deletePending.id);
      if (selectedId === deletePending.id) setSelectedId(null);
      setDeletePending(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  const childrenByParent = useMemo(() => {
    const map = new Map<string, KnowledgeSource[]>();
    for (const s of sources) {
      if (s.parentId) {
        const arr = map.get(s.parentId) ?? [];
        arr.push(s);
        map.set(s.parentId, arr);
      }
    }
    for (const [id, arr] of map) {
      arr.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      map.set(id, arr);
    }
    return map;
  }, [sources]);

  const totalsById = useMemo(() => {
    const map = new Map<string, { size: number; pageCount: number; chunkCount: number }>();
    const compute = (id: string): { size: number; pageCount: number; chunkCount: number } => {
      const cached = map.get(id);
      if (cached) return cached;
      const s = sources.find((x) => x.id === id);
      const children = childrenByParent.get(id) ?? [];
      let size = s?.size ?? 0;
      let pageCount = s?.pageCount ?? 0;
      let chunkCount = s?.chunkCount ?? 0;
      for (const c of children) {
        const child = compute(c.id);
        size += child.size;
        pageCount += child.pageCount;
        chunkCount += child.chunkCount;
      }
      const t = { size, pageCount, chunkCount };
      map.set(id, t);
      return t;
    };
    for (const s of sources) compute(s.id);
    return map;
  }, [sources, childrenByParent]);

  const visibleRows = useMemo(() => {
    const rows: { source: KnowledgeSource; depth: number; childCount: number; totals: { size: number; pageCount: number; chunkCount: number } }[] = [];
    const roots = sources
      .filter((s) => !s.parentId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const add = (source: KnowledgeSource, depth: number) => {
      const children = childrenByParent.get(source.id) ?? [];
      rows.push({ source, depth, childCount: children.length, totals: totalsById.get(source.id) ?? { size: source.size, pageCount: source.pageCount ?? 0, chunkCount: source.chunkCount ?? 0 } });
      if (expandedParents.has(source.id) && children.length) {
        for (const child of children) add(child, depth + 1);
      }
    };
    for (const root of roots) add(root, 0);
    return rows;
  }, [sources, childrenByParent, expandedParents, totalsById]);

  const toggleParent = useCallback((id: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const {
    visibleIndices: vaultVisibleIndices,
    topSpacerPx: vaultTopSpacer,
    bottomSpacerPx: vaultBottomSpacer,
  } = useVirtualGrid(vaultScrollRef, {
    itemCount: visibleRows.length,
    rowHeight: 92,
    minColWidth: 2000, // force 1-column list virtualization
    gap: 8,
    threshold: 20,
  });

  const acceptedSet = useMemo(
    () => new Set(ACCEPTED_EXTS.split(',').map((e) => e.trim().toLowerCase())),
    [],
  );

  const isAccepted = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    return acceptedSet.has(`.${ext}`);
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const accepted = Array.from(files).filter(isAccepted);
    await Promise.allSettled(
      accepted.map(async (file) => {
        try {
          await upload(file);
        } catch {
          // Hook surfaces errors; keep remaining uploads moving.
        }
      }),
    );
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) setDragOver(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragOver(false);
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragOver(false);
    void handleFiles(e.dataTransfer.files);
  };

  const totalBytes = sources.reduce((sum, s) => sum + (s.size ?? 0), 0);
  const readyCount = sources.filter((s) => s.status === 'ready').length;
  const activeCount = sources.filter((s) => isActiveStatus(s.status)).length;
  const dossierSource = sources.find((s) => s.id === selectedId) ?? null;
  const dossierTotals = dossierSource ? (totalsById.get(dossierSource.id) ?? null) : null;

  const handleScan = useCallback(async (url: string) => {
    return await scan(url);
  }, [scan]);

  const handleScrapeRoot = useCallback(async (url: string) => {
    const source = await scrape(url);
    void refresh();
    return source;
  }, [scrape, refresh]);

  const handleScrapeRefs = useCallback(async (urls: string[], opts: { maxDepth: number; maxLinks: number; rootUrl?: string }) => {
    const batchId = await scrapeRefs(urls, undefined, { ...opts, rootUrl: opts.rootUrl });
    void refresh();
    return batchId;
  }, [scrapeRefs, refresh]);

  const handlePauseBatch = useCallback(async (batchId: string) => {
    await pauseBatch(batchId);
  }, [pauseBatch]);

  const handleResumeBatch = useCallback(async (batchId: string) => {
    await resumeBatch(batchId);
  }, [resumeBatch]);

  const handleCancelBatch = useCallback(async (batchId: string) => {
    await cancelBatch(batchId);
  }, [cancelBatch]);

  useEffect(() => {
    if (selectedId && !sources.some((s) => s.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, sources]);

  useEffect(() => {
    void neuralCortex
      .status()
      .then((status) => setCortexDegraded(status.degraded === true))
      .catch(() => setCortexDegraded(false));
  }, []);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: colors.bg.primary }}>
      <PanelHeader
        title="KNOWLEDGE DECK"
        subtitle="DOCUMENT VAULT // UPLOAD · INDEX · MAINTAIN"
        icon={<LibraryBooksIcon sx={{ fontSize: 20 }} />}
        action={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {activeCount > 0 && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  px: 1,
                  py: 0.25,
                  border: `1px solid ${alphaColor(colors.accent.blue, 0.4)}`,
                  borderRadius: 0.5,
                  bgcolor: alphaColor(colors.accent.blue, 0.08),
                }}
              >
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: colors.accent.blue, animation: 'kbPulse 1s ease-in-out infinite' }} />
                <Typography sx={{ fontSize: '0.6rem', color: colors.accent.blue, fontFamily: MONO, letterSpacing: 1 }}>
                  {activeCount} INGESTING
                </Typography>
              </Box>
            )}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                px: 1,
                py: 0.25,
                border: `1px solid ${colors.border.default}`,
                borderRadius: 0.5,
                bgcolor: colors.bg.tertiary,
              }}
            >
              <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, fontFamily: MONO, letterSpacing: 1 }}>
                {readyCount}/{sources.length} READY
              </Typography>
              <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, fontFamily: MONO }}>·</Typography>
              <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, fontFamily: MONO }}>
                {formatBytes(totalBytes)}
              </Typography>
            </Box>
            <Tooltip title="Refresh vault">
              <IconButton size="small" onClick={() => void refresh()} sx={{ color: colors.text.dim }}>
                <RefreshIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        }
      />

      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          p: 2.5,
        }}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {error && (
          <Box
            sx={{
              mb: 1.5,
              p: 1,
              border: `1px solid ${alphaColor(colors.accent.red, 0.35)}`,
              borderRadius: 0.5,
              bgcolor: alphaColor(colors.accent.red, 0.06),
            }}
          >
            <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: colors.accent.red, wordBreak: 'break-word' }}>
              {truncateError(error, 320)}
            </Typography>
          </Box>
        )}

        {cortexDegraded && (
          <Box
            sx={{
              mb: 1.5,
              p: 1,
              border: `1px solid ${alphaColor(colors.accent.orange, 0.35)}`,
              borderRadius: 0.5,
              bgcolor: alphaColor(colors.accent.orange, 0.06),
            }}
          >
            <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: colors.accent.orange, letterSpacing: 1.5, mb: 0.25 }}>
              NEURAL CORTEX DEGRADED
            </Typography>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: colors.accent.orange, wordBreak: 'break-word' }}>
              Semantic embeddings unavailable — running n-gram fallback. Knowledge Base search quality may be reduced until the embedding model is downloaded.
            </Typography>
          </Box>
        )}

        <SpyHudScrapePanel
          onScan={handleScan}
          onScrapeRoot={handleScrapeRoot}
          onScrapeRefs={handleScrapeRefs}
          onPauseBatch={handlePauseBatch}
          onResumeBatch={handleResumeBatch}
          onCancelBatch={handleCancelBatch}
          batchProgress={batchProgress}
        />

        <TacticalDropZone dragOver={dragOver} onClick={() => fileInputRef.current?.click()} />
        <input
          ref={fileInputRef}
          type="file"
          hidden
          multiple
          accept={ACCEPTED_EXTS}
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />

        <Box sx={{ mt: 2.5 }}>
          <Collapse in={dossierSource != null} timeout={{ enter: 320, exit: 260 }} unmountOnExit>
            <Box>
              <SectionHeader label="SOURCE DOSSIER" />
              {dossierSource?.sourceUrl ? (
                <UrlScrapeDossier
                  source={dossierSource}
                  statusDetail={ingestDetails[dossierSource.id]}
                  children={childrenByParent.get(dossierSource.id) ?? []}
                  cumulative={dossierTotals ?? undefined}
                  onClose={() => setSelectedId((prev) => (prev === dossierSource.id ? null : prev))}
                  onReprocess={() => void rescrape(dossierSource.id)}
                  onDelete={() => requestDeleteSource(dossierSource.id, dossierSource.name)}
                  onPause={() => void pause(dossierSource.id)}
                  onResume={() => void resume(dossierSource.id)}
                />
              ) : dossierSource ? (
                <DossierMonitor
                  source={dossierSource}
                  statusDetail={ingestDetails[dossierSource.id]}
                  onClose={() => setSelectedId((prev) => (prev === dossierSource.id ? null : prev))}
                  onReprocess={() => void (dossierSource.sourceUrl ? rescrape(dossierSource.id) : reprocess(dossierSource.id))}
                  onDelete={() => requestDeleteSource(dossierSource.id, dossierSource.name)}
                />
              ) : null}
            </Box>
          </Collapse>
        </Box>

        <Box sx={{ mt: 2.5 }}>
          <SectionHeader label="SOURCE VAULT" count={sources.length} />
          <Box
            ref={vaultScrollRef}
            sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, maxHeight: 480, overflow: 'auto' }}
          >
            {sources.length === 0 && !loading && (
              <Box sx={{ textAlign: 'center', py: 3.5, border: `1px dashed ${colors.border.subtle}`, borderRadius: 0.5 }}>
                <StorageIcon sx={{ fontSize: 28, color: colors.text.dim, mb: 0.5, opacity: 0.4 }} />
                <Typography sx={{ fontSize: '0.65rem', color: colors.text.dim, fontFamily: MONO, letterSpacing: 1 }}>
                  VAULT EMPTY // AWAITING INTEL PACKAGES
                </Typography>
              </Box>
            )}
            {vaultTopSpacer > 0 && <Box sx={{ height: vaultTopSpacer, flexShrink: 0 }} />}
            {vaultVisibleIndices.map((idx) => {
              const row = visibleRows[idx];
              if (!row) return null;
              const { source, depth, childCount, totals } = row;
              const canExpand = childCount > 0;
              return (
                <SourceCard
                  key={source.id}
                  source={source}
                  depth={depth}
                  childCount={childCount}
                  expanded={canExpand && expandedParents.has(source.id)}
                  onToggle={canExpand ? () => toggleParent(source.id) : undefined}
                  selected={source.id === selectedId}
                  onSelect={() => setSelectedId((prev) => (prev === source.id ? null : source.id))}
                  onView={() => setViewer({
                    id: source.storageId,
                    name: source.name,
                    mimeType: source.mimeType,
                  })}
                  onReprocess={() => void (source.sourceUrl ? rescrape(source.id) : reprocess(source.id))}
                  onDelete={() => requestDeleteSource(source.id, source.name)}
                  totals={totals}
                />
              );
            })}
            {vaultBottomSpacer > 0 && <Box sx={{ height: vaultBottomSpacer, flexShrink: 0 }} />}
          </Box>
        </Box>
      </Box>

      <FileViewerModal
        open={!!viewer}
        onClose={() => setViewer(null)}
        id={viewer?.id ?? ''}
        name={viewer?.name ?? 'Document'}
        mimeType={viewer?.mimeType}
      />

      <ConfirmDeleteDialog
        open={Boolean(deletePending)}
        busy={deleteBusy}
        title="DELETE KNOWLEDGE SOURCE"
        description="Permanently delete knowledge source"
        itemName={deletePending?.name}
        onClose={() => setDeletePending(null)}
        onConfirm={() => { void confirmDeleteSource(); }}
      />

      <style>{`
        @keyframes kbPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
        @keyframes kbScan { 0% { transform: translateY(-100%); } 100% { transform: translateY(400%); } }
        @keyframes kbMarch { to { background-position: 16px 0; } }
      `}</style>
    </Box>
  );
}
