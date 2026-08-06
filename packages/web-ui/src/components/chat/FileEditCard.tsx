// FileEditCard.tsx — Devin-style card for file_write / file_edit / file_patch
// tool calls. Shows the filename in a header and the content being written or
// the diff being applied in a scrollable code view.

import { useState, memo, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import DescriptionIcon from '@mui/icons-material/Description';
import EditIcon from '@mui/icons-material/Edit';
import { colors, alphaColor, MONO } from '../../theme';
import type { ToolCall } from '../../chat/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getFilename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || p;
}

function extractArgs(args: ToolCall['args']): Record<string, unknown> {
  if (!args) return {};
  if (typeof args === 'string') {
    try { return JSON.parse(args) as Record<string, unknown>; } catch { return {}; }
  }
  return args;
}

/** Extract the file path from the tool args, handling different arg key names. */
function extractFilePath(parsed: Record<string, unknown>): string {
  return String(parsed.path || parsed.filePath || parsed.file || '');
}

/** Determine the tool variant and extract the relevant content. */
interface FileEditContent {
  kind: 'write' | 'edit' | 'patch';
  filePath: string;
  /** For file_write: the full content being written. */
  newContent?: string;
  /** For file_edit: the old string being replaced. */
  oldString?: string;
  /** For file_edit: the new string replacing the old. */
  newString?: string;
  /** For file_patch: the array of edits. */
  edits?: Array<{ search: string; replace: string }>;
}

function extractFileEditContent(tool: ToolCall): FileEditContent | null {
  const parsed = extractArgs(tool.args);
  const filePath = extractFilePath(parsed);
  if (!filePath) return null;

  switch (tool.name) {
    case 'file_write':
    case 'write_file':
      return {
        kind: 'write',
        filePath,
        newContent: typeof parsed.content === 'string' ? parsed.content : undefined,
      };
    case 'file_edit':
    case 'code_replace':
      return {
        kind: 'edit',
        filePath,
        oldString: typeof parsed.old_string === 'string' ? parsed.old_string : undefined,
        newString: typeof parsed.new_string === 'string' ? parsed.new_string : undefined,
      };
    case 'file_patch':
    case 'apply_patch': {
      const editsRaw = parsed.edits;
      let edits: Array<{ search: string; replace: string }> | undefined;
      if (Array.isArray(editsRaw)) {
        edits = editsRaw.map((e) => ({
          search: String(e?.search ?? ''),
          replace: String(e?.replace ?? ''),
        }));
      }
      return { kind: 'patch', filePath, edits };
    }
    default:
      return null;
  }
}

/** Check if a tool name is a file write/edit/patch operation. */
export function isFileEditTool(toolName: string): boolean {
  return toolName === 'file_write' || toolName === 'write_file'
    || toolName === 'file_edit' || toolName === 'code_replace'
    || toolName === 'file_patch' || toolName === 'apply_patch';
}

// ─── Diff line renderer ───────────────────────────────────────────────────────

/** Render a simple line-by-line diff between old and new strings. */
function renderDiffLines(oldStr: string, newStr: string): Array<{ type: 'add' | 'del' | 'ctx'; text: string }> {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const result: Array<{ type: 'add' | 'del' | 'ctx'; text: string }> = [];

  // Simple line-by-line diff (not a full LCS diff, but good enough for display)
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === newLine) {
      if (oldLine !== undefined) result.push({ type: 'ctx', text: oldLine });
    } else {
      if (oldLine !== undefined) result.push({ type: 'del', text: oldLine });
      if (newLine !== undefined) result.push({ type: 'add', text: newLine });
    }
  }
  return result;
}

// ─── Component ────────────────────────────────────────────────────────────────

function FileEditCardImpl({ tool, defaultExpanded = false }: { tool: ToolCall; defaultExpanded?: boolean }) {
  const content = useMemo(() => extractFileEditContent(tool), [tool]);
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (!content) return null;

  const isRunning = tool.status === 'running';
  const isError = tool.status === 'error';
  const filename = getFilename(content.filePath);

  const icon = content.kind === 'write' ? <DescriptionIcon sx={{ fontSize: 14 }} /> : <EditIcon sx={{ fontSize: 14 }} />;
  const actionLabel = content.kind === 'write' ? 'Writing' : content.kind === 'edit' ? 'Editing' : 'Patching';
  const statusLabel = isRunning
    ? `${actionLabel}…`
    : isError
      ? 'Failed'
      : 'Done';

  // Determine what to show in the content area
  const diffLines = useMemo(() => {
    if (content.kind === 'edit' && content.oldString && content.newString) {
      return renderDiffLines(content.oldString, content.newString);
    }
    if (content.kind === 'patch' && content.edits) {
      // For patches, show all edits as a combined diff
      const allLines: Array<{ type: 'add' | 'del' | 'ctx'; text: string }> = [];
      content.edits.forEach((edit, idx) => {
        if (idx > 0) allLines.push({ type: 'ctx', text: '─── edit boundary ───' });
        allLines.push(...renderDiffLines(edit.search, edit.replace));
      });
      return allLines;
    }
    return null;
  }, [content]);

  const writeContent = content.kind === 'write' ? content.newContent : null;
  // Cap rendered lines to avoid lag on very large file writes/diffs.
  const MAX_LINES = 500;
  const cappedWriteContent = writeContent && writeContent.split('\n').length > MAX_LINES
    ? writeContent.split('\n').slice(0, MAX_LINES).join('\n') + `\n… (${writeContent.split('\n').length - MAX_LINES} more lines truncated)`
    : writeContent;
  const cappedDiffLines = diffLines && diffLines.length > MAX_LINES
    ? [...diffLines.slice(0, MAX_LINES), { type: 'ctx' as const, text: `… (${diffLines.length - MAX_LINES} more lines truncated)` }]
    : diffLines;
  const lineCount = writeContent
    ? writeContent.split('\n').length
    : diffLines
      ? diffLines.length
      : 0;

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
        <Box sx={{ color: isRunning ? colors.accent.blue : isError ? colors.accent.red : colors.text.dim, display: 'flex', alignItems: 'center', opacity: 0.7 }}>
          {icon}
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
            {actionLabel} {filename}
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
          {lineCount > 0 && (
            <Typography sx={{ fontSize: '0.42rem', fontFamily: MONO, color: colors.text.dim }}>
              {lineCount} lines
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
          {/* For file_write: show the content being written */}
          {cappedWriteContent && (
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
                tabSize: 2,
              }}
            >
              {cappedWriteContent}
            </Box>
          )}

          {/* For file_edit / file_patch: show the diff */}
          {cappedDiffLines && (
            <Box sx={{ fontFamily: MONO, fontSize: '0.6rem', lineHeight: 1.5 }}>
              {cappedDiffLines.map((line, idx) => (
                <Box
                  key={idx}
                  sx={{
                    display: 'flex',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    py: 0.05,
                    px: 0.5,
                    borderLeft: `2px solid ${
                      line.type === 'add' ? colors.accent.green
                      : line.type === 'del' ? colors.accent.red
                      : 'transparent'
                    }`,
                    bgcolor:
                      line.type === 'add' ? alphaColor(colors.accent.green, '08')
                      : line.type === 'del' ? alphaColor(colors.accent.red, '08')
                      : 'transparent',
                    color:
                      line.type === 'add' ? alphaColor(colors.accent.green, 'cc')
                      : line.type === 'del' ? alphaColor(colors.accent.red, 'cc')
                      : colors.text.dim,
                  }}
                >
                  <Box component="span" sx={{ flexShrink: 0, width: '1.2em', textAlign: 'center', color: colors.text.dim, userSelect: 'none' }}>
                    {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                  </Box>
                  <Box component="span" sx={{ flex: 1 }}>
                    {line.text || ' '}
                  </Box>
                </Box>
              ))}
            </Box>
          )}

          {/* Fallback: if no content was extracted, show streamOutput or result */}
          {!writeContent && !diffLines && (tool.streamOutput || tool.result) && (
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
              {tool.streamOutput || tool.result}
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

function fileEditCardPropsEqual(prev: { tool: ToolCall }, next: { tool: ToolCall }): boolean {
  return prev.tool.id === next.tool.id
    && prev.tool.status === next.tool.status
    && prev.tool.args === next.tool.args
    && prev.tool.result === next.tool.result
    && prev.tool.streamOutput === next.tool.streamOutput;
}

export const FileEditCard = memo(FileEditCardImpl, fileEditCardPropsEqual);
