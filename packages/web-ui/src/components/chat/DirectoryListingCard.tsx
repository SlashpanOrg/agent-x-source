// DirectoryListingCard.tsx — card for folder_list / list_dir /
// folder_tree / folder_open / folder_create tool calls. Shows the directory
// path in a header and the listing contents in a scrollable tree-like view.

import { useState, memo, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
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

function extractPath(parsed: Record<string, unknown>): string {
  return String(parsed.path || parsed.dir || parsed.directory || parsed.folder || '');
}

const FILE_EXT_RE = /\.[a-z0-9]+$/i;

interface ListingEntry {
  indent: number;
  name: string;
  isDir: boolean;
  prefix: string;
}

function parseListing(text: string): ListingEntry[] {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  const entries: ListingEntry[] = [];

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;

    const treeMatch = line.match(/^(\s*[│ ]*)(├──|└──|├─|└─)\s+(.+)$/);
    if (treeMatch) {
      const treeIndent = treeMatch[1];
      const branch = treeMatch[2];
      const nameRaw = treeMatch[3].trim();
      const indent = Math.floor((treeIndent.replace(/│/g, '  ').length + (branch.startsWith('├') ? 1 : 1)) / 2);
      const isDir = nameRaw.endsWith('/') || nameRaw.endsWith('\\');
      const name = nameRaw.replace(/[\\/]+$/, '');
      entries.push({ indent, name, isDir, prefix: `${treeIndent}${branch} ` });
      continue;
    }

    const spaceMatch = line.match(/^(\s*)(.+)$/);
    if (spaceMatch) {
      const indentStr = spaceMatch[1];
      const nameRaw = spaceMatch[2].trim();
      if (!nameRaw) continue;
      const indent = Math.floor(indentStr.length / 2);
      const isDir = nameRaw.endsWith('/') || nameRaw.endsWith('\\');
      const name = nameRaw.replace(/[\\/]+$/, '');
      entries.push({ indent, name, isDir, prefix: indentStr });
      continue;
    }
  }

  return entries;
}

function inferIsDir(name: string): boolean {
  if (name.endsWith('/') || name.endsWith('\\')) return true;
  if (FILE_EXT_RE.test(name)) return false;
  return false;
}

export function isDirectoryListTool(toolName: string): boolean {
  return toolName === 'folder_list'
    || toolName === 'list_dir'
    || toolName === 'folder_tree'
    || toolName === 'folder_open'
    || toolName === 'folder_create';
}

// ─── Component ────────────────────────────────────────────────────────────────

function DirectoryListingCardImpl({ tool, defaultExpanded = false }: { tool: ToolCall; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const parsed = useMemo(() => extractArgs(tool.args), [tool.args]);
  const dirPath = useMemo(() => extractPath(parsed), [parsed]);

  const resultText = tool.result || tool.streamOutput || '';
  const entries = useMemo(() => {
    const all = parseListing(resultText);
    // Cap rendered entries to avoid huge DOM trees for large directories.
    return all.slice(0, 500);
  }, [resultText]);

  const isRunning = tool.status === 'running';
  const isError = tool.status === 'error';

  const displayPath = dirPath || tool.name;
  const statusLabel = isRunning
    ? 'Listing…'
    : isError
      ? 'Failed'
      : 'Done';

  const itemCount = entries.length;

  return (
    <Box sx={{
      mb: 0.25,
      border: `1px solid ${isError ? alphaColor(colors.accent.red, '20') : isRunning ? alphaColor(colors.accent.blue, '20') : alphaColor(colors.border.subtle, '50')}`,
      borderRadius: 0.75,
      overflow: 'hidden',
      bgcolor: 'transparent',
      transition: 'border-color 0.2s',
    }}>
      {/* ─── Header ─── */}
      <Box
        onClick={() => setExpanded(!expanded)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 0.75,
          py: 0.25,
          cursor: 'pointer',
          bgcolor: 'transparent',
          borderBottom: expanded ? `1px solid ${alphaColor(colors.border.subtle, '50')}` : 'none',
          '&:hover': { bgcolor: alphaColor(colors.bg.hover, '40') },
        }}
      >
        <Box sx={{ color: isRunning ? colors.accent.blue : isError ? colors.accent.red : colors.accent.orange, display: 'flex', alignItems: 'center', opacity: 0.7 }}>
          <FolderIcon sx={{ fontSize: 12 }} />
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{
            fontSize: '0.62rem',
            fontFamily: MONO,
            fontWeight: 400,
            color: colors.text.secondary,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {displayPath}
          </Typography>
        </Box>

        {/* Status indicator */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
          {isRunning ? (
            <Typography sx={{
              fontSize: '0.48rem',
              fontFamily: MONO,
              color: colors.accent.blue,
              fontWeight: 400,
              animation: 'agentx-pulse 1.4s ease-in-out infinite',
            }}>
              {statusLabel}
            </Typography>
          ) : isError ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
              <ErrorIcon sx={{ fontSize: 10, color: colors.accent.red }} />
              <Typography sx={{ fontSize: '0.48rem', fontFamily: MONO, color: colors.accent.red, fontWeight: 400 }}>
                {statusLabel}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
              <CheckCircleIcon sx={{ fontSize: 10, color: colors.accent.green }} />
              <Typography sx={{ fontSize: '0.48rem', fontFamily: MONO, color: colors.accent.green, fontWeight: 400 }}>
                {statusLabel}
              </Typography>
            </Box>
          )}
          {itemCount > 0 && (
            <Typography sx={{
              fontSize: '0.42rem',
              fontFamily: MONO,
              color: colors.text.dim,
            }}>
              {itemCount} items
            </Typography>
          )}
        </Box>

        <IconButton size="small" sx={{ p: 0.15, color: colors.text.dim }} onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
          {expanded ? <ExpandLessIcon sx={{ fontSize: 12 }} /> : <ExpandMoreIcon sx={{ fontSize: 12 }} />}
        </IconButton>
      </Box>

      {/* ─── Content ─── */}
      <Collapse in={expanded} unmountOnExit>
        <Box sx={{
          maxHeight: 140,
          overflow: 'auto',
          px: 1,
          py: 0.5,
          bgcolor: colors.bg.primary,
          contentVisibility: 'auto',
        }}>
          {entries.length > 0 ? (
            <Box sx={{ fontFamily: MONO, fontSize: '0.6rem', lineHeight: 1.6 }}>
              {entries.map((entry, idx) => {
                const isDir = entry.isDir || inferIsDir(entry.name);
                return (
                  <Box
                    key={idx}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      whiteSpace: 'pre',
                      py: 0.05,
                    }}
                  >
                    <Box
                      component="span"
                      sx={{
                        flexShrink: 0,
                        color: isDir ? colors.accent.orange : colors.text.dim,
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      {isDir
                        ? <FolderIcon sx={{ fontSize: 12 }} />
                        : <InsertDriveFileIcon sx={{ fontSize: 12 }} />}
                    </Box>
                    <Box
                      component="span"
                      sx={{
                        color: isDir ? alphaColor(colors.accent.orange, 'cc') : colors.text.secondary,
                        fontWeight: isDir ? 600 : 400,
                      }}
                    >
                      {entry.name}
                      {isDir ? '/' : ''}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          ) : resultText ? (
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
              {resultText}
            </Box>
          ) : isRunning ? (
            <Typography sx={{ fontSize: '0.6rem', fontFamily: MONO, color: colors.text.dim, fontStyle: 'italic' }}>
              Waiting for listing…
            </Typography>
          ) : (
            <Typography sx={{ fontSize: '0.6rem', fontFamily: MONO, color: colors.text.dim, fontStyle: 'italic' }}>
              Empty directory
            </Typography>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

function directoryListingCardPropsEqual(prev: { tool: ToolCall }, next: { tool: ToolCall }): boolean {
  return prev.tool.id === next.tool.id
    && prev.tool.status === next.tool.status
    && prev.tool.args === next.tool.args
    && prev.tool.result === next.tool.result
    && prev.tool.streamOutput === next.tool.streamOutput;
}

export const DirectoryListingCard = memo(DirectoryListingCardImpl, directoryListingCardPropsEqual);
