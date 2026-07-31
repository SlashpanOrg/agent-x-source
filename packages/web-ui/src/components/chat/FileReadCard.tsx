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
import { colors, alphaColor, MONO } from '../../theme';
import type { ToolCall } from '../../chat/types';

function getFilename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || p;
}

function getDirectory(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  parts.pop();
  return parts.join('/') || '/';
}

function extractArgs(args: ToolCall['args']): Record<string, unknown> {
  if (!args) return {};
  if (typeof args === 'string') {
    try { return JSON.parse(args) as Record<string, unknown>; } catch { return {}; }
  }
  return args;
}

function extractFilePath(parsed: Record<string, unknown>): string {
  return String(parsed.path || parsed.filePath || parsed.target_file || '');
}

interface ParsedLine {
  num: number;
  text: string;
}

interface FileSection {
  filePath: string;
  lines: ParsedLine[];
}

const LINE_NUM_RE = /^\s*(\d+)\s*[\t|]\s?(.*)$/;

function parseLineNumberedContent(raw: string): ParsedLine[] {
  const rawLines = raw.split('\n');
  let hasLineNums = false;
  const peek = rawLines.slice(0, 50);
  for (const l of peek) {
    if (l.trim() === '') continue;
    if (LINE_NUM_RE.test(l)) { hasLineNums = true; break; }
  }
  if (!hasLineNums) {
    return rawLines.map((text, i) => ({ num: i + 1, text }));
  }
  const result: ParsedLine[] = [];
  let lastNum = 0;
  for (const line of rawLines) {
    const m = line.match(LINE_NUM_RE);
    if (m) {
      const num = parseInt(m[1], 10);
      lastNum = num;
      result.push({ num, text: m[2] });
    } else {
      lastNum += 1;
      result.push({ num: lastNum, text: line });
    }
  }
  return result;
}

function extractContentString(tool: ToolCall): string {
  return String(tool.result || tool.streamOutput || '');
}

function parseBatchResult(raw: string): FileSection[] {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry): FileSection | null => {
          if (!entry || typeof entry !== 'object') return null;
          const fp = String(entry.path || entry.filePath || entry.file || entry.target_file || '');
          const content = String(entry.content ?? entry.result ?? entry.text ?? '');
          if (!fp && !content) return null;
          return { filePath: fp, lines: parseLineNumberedContent(content) };
        })
        .filter((s): s is FileSection => s !== null);
    }
    if (parsed && typeof parsed === 'object') {
      const fp = String(parsed.path || parsed.filePath || parsed.file || '');
      const content = String(parsed.content ?? parsed.result ?? parsed.text ?? '');
      if (fp || content) return [{ filePath: fp, lines: parseLineNumberedContent(content) }];
    }
  } catch {
    // fall through to text-based parsing
  }
  const sections: FileSection[] = [];
  const headerRe = /^={2,}\s*(.+?)\s*={2,}$/;
  const altHeaderRe = /^#{1,3}\s+(.+)$/;
  let current: FileSection | null = null;
  const buffer: string[] = [];
  const flush = () => {
    if (current) {
      current.lines = parseLineNumberedContent(buffer.join('\n'));
      sections.push(current);
    }
    buffer.length = 0;
  };
  for (const line of raw.split('\n')) {
    const h1 = line.match(headerRe);
    const h2 = line.match(altHeaderRe);
    if (h1 || h2) {
      flush();
      current = { filePath: (h1 ? h1[1] : h2![1]).trim(), lines: [] };
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();
  return sections;
}

interface FileReadContent {
  isBatch: boolean;
  filePath: string;
  sections: FileSection[];
}

function extractFileReadContent(tool: ToolCall): FileReadContent | null {
  const parsed = extractArgs(tool.args);
  const filePath = extractFilePath(parsed);
  const isBatch = tool.name === 'file_read_batch';
  const raw = extractContentString(tool);
  if (!raw && !filePath) return null;

  if (isBatch) {
    const sections = parseBatchResult(raw);
    if (sections.length > 0) {
      return { isBatch: true, filePath: filePath || sections[0].filePath, sections };
    }
  }

  const lines = parseLineNumberedContent(raw);
  if (lines.length === 0 && !filePath) return null;
  return {
    isBatch: false,
    filePath,
    sections: [{ filePath, lines }],
  };
}

export function isFileReadTool(toolName: string): boolean {
  return toolName === 'file_read' || toolName === 'read_file'
    || toolName === 'read' || toolName === 'cat'
    || toolName === 'file_read_batch';
}

function LineRow({ line, maxNumWidth }: { line: ParsedLine; maxNumWidth: string }) {
  return (
    <Box sx={{ display: 'flex', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      <Box
        component="span"
        style={{ width: maxNumWidth, flexShrink: 0 }}
        sx={{
          pr: 1,
          textAlign: 'right',
          color: colors.text.dim,
          userSelect: 'none',
          fontFamily: MONO,
          fontSize: '0.6rem',
          lineHeight: 1.5,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        {line.num}
      </Box>
      <Box
        component="span"
        sx={{
          flex: 1,
          fontFamily: MONO,
          fontSize: '0.6rem',
          lineHeight: 1.5,
          color: colors.text.secondary,
        }}
      >
        {line.text || ' '}
      </Box>
    </Box>
  );
}

const MAX_RENDERED_LINES = 500;

function FileSectionView({ section }: { section: FileSection }) {
  const maxNum = section.lines.length > 0 ? section.lines[section.lines.length - 1].num : 0;
  const maxNumWidth = `${String(maxNum).length + 1}ch`;
  const visibleLines = section.lines.slice(0, MAX_RENDERED_LINES);
  const truncated = section.lines.length > MAX_RENDERED_LINES;
  return (
    <Box>
      {section.filePath && (
        <Typography sx={{
          fontSize: '0.55rem',
          fontFamily: MONO,
          color: colors.text.dim,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          py: 0.25,
          borderBottom: `1px solid ${colors.border.subtle}`,
          mb: 0.25,
        }}>
          {section.filePath}
        </Typography>
      )}
      {visibleLines.map((line, idx) => (
        <LineRow key={idx} line={line} maxNumWidth={maxNumWidth} />
      ))}
      {truncated && (
        <Typography sx={{ fontSize: '0.5rem', fontFamily: MONO, color: colors.text.dim, py: 0.25, fontStyle: 'italic' }}>
          … {section.lines.length - MAX_RENDERED_LINES} more lines (scroll to read full output)
        </Typography>
      )}
    </Box>
  );
}

function FileReadCardImpl({ tool, defaultExpanded = false }: { tool: ToolCall; defaultExpanded?: boolean }) {
  const content = useMemo(() => extractFileReadContent(tool), [tool]);
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (!content) return null;

  const isRunning = tool.status === 'running';
  const isError = tool.status === 'error';
  const filename = content.filePath ? getFilename(content.filePath) : 'file';
  const directory = content.filePath ? getDirectory(content.filePath) : '';

  const totalLines = content.sections.reduce((acc, s) => acc + s.lines.length, 0);

  const statusLabel = isRunning
    ? 'Reading…'
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
          <DescriptionIcon sx={{ fontSize: 14 }} />
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
            {filename}
          </Typography>
          {directory && (
            <Typography sx={{
              fontSize: '0.5rem',
              fontFamily: MONO,
              color: colors.text.dim,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {directory}
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
          {totalLines > 0 && (
            <Typography sx={{ fontSize: '0.45rem', fontFamily: MONO, color: colors.text.dim }}>
              {totalLines} lines
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
          {content.sections.map((section, idx) => (
            <Box key={idx} sx={content.isBatch && content.sections.length > 1 && idx > 0 ? { mt: 1, pt: 1, borderTop: `1px solid ${colors.border.subtle}` } : {}}>
              <FileSectionView section={section} />
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

function fileReadCardPropsEqual(prev: { tool: ToolCall }, next: { tool: ToolCall }): boolean {
  return prev.tool.id === next.tool.id
    && prev.tool.status === next.tool.status
    && prev.tool.args === next.tool.args
    && prev.tool.result === next.tool.result
    && prev.tool.streamOutput === next.tool.streamOutput;
}

export const FileReadCard = memo(FileReadCardImpl, fileReadCardPropsEqual);
