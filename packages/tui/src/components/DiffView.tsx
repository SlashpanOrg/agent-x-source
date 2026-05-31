import { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { COLORS } from '../theme/colors.js';

interface HunkLine {
  type: 'add' | 'del' | 'ctx';
  oldLine: number;
  newLine: number;
  content: string;
}

interface Hunk {
  header: string;
  lines: HunkLine[];
  accepted: boolean;
}

interface DiffFile {
  oldPath: string;
  newPath: string;
  hunks: Hunk[];
}

interface DiffViewProps {
  diff: string;
  onAccept?: (fileIndex: number, hunkIndex: number) => void;
  onReject?: (fileIndex: number, hunkIndex: number) => void;
  onAcceptAll?: () => void;
  onRejectAll?: () => void;
  onClose?: () => void;
}

function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let currentFile: DiffFile | null = null;
  let currentHunk: Hunk | null = null;
  let oldLineOffset = 0;
  let newLineOffset = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git')) {
      if (currentFile && currentHunk) {
        currentFile.hunks.push(currentHunk);
      }
      if (currentFile) files.push(currentFile);
      const match = line.match(/diff --git a\/(.+) b\/(.+)/);
      currentFile = {
        oldPath: match?.[1] ?? '',
        newPath: match?.[2] ?? '',
        hunks: [],
      };
      currentHunk = null;
    } else if (line.startsWith('@@')) {
      if (currentFile && currentHunk) {
        currentFile.hunks.push(currentHunk);
      }
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldLineOffset = match ? parseInt(match[1]!, 10) : 0;
      newLineOffset = match ? parseInt(match[2]!, 10) : 0;
      currentHunk = {
        header: line,
        lines: [],
        accepted: true,
      };
    } else if (currentHunk) {
      if (line.startsWith('+')) {
        currentHunk.lines.push({
          type: 'add',
          oldLine: 0,
          newLine: newLineOffset++,
          content: line.slice(1),
        });
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({
          type: 'del',
          oldLine: oldLineOffset++,
          newLine: 0,
          content: line.slice(1),
        });
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push({
          type: 'ctx',
          oldLine: oldLineOffset++,
          newLine: newLineOffset++,
          content: line.slice(1),
        });
      }
    }
  }

  if (currentFile && currentHunk) currentFile.hunks.push(currentHunk);
  if (currentFile) files.push(currentFile);

  return files;
}

export const DiffView: React.FC<DiffViewProps> = ({ diff, onAccept, onReject, onAcceptAll, onRejectAll, onClose }) => {
  const files = parseDiff(diff);
  const [fileIdx, setFileIdx] = useState(0);
  const [hunkIdx, setHunkIdx] = useState(0);
  const [showHelp, setShowHelp] = useState(false);

  const currentFile = files[fileIdx];
  const currentHunk = currentFile?.hunks[hunkIdx];
  const totalHunks = currentFile?.hunks.length ?? 0;

  useInput(useCallback((input: string, key) => {
    if (key.escape) { onClose?.(); return; }
    if (input === '?') { setShowHelp((v) => !v); return; }

    if (key.upArrow && hunkIdx > 0) setHunkIdx((i) => i - 1);
    if (key.downArrow && hunkIdx < totalHunks - 1) setHunkIdx((i) => i + 1);
    if (key.leftArrow && fileIdx > 0) { setFileIdx((i) => i - 1); setHunkIdx(0); }
    if (key.rightArrow && fileIdx < files.length - 1) { setFileIdx((i) => i + 1); setHunkIdx(0); }

    if (input === 'a' || input === 'A') onAccept?.(fileIdx, hunkIdx);
    if (input === 'r' || input === 'R') onReject?.(fileIdx, hunkIdx);
    if (input === 'd' || input === 'D') onAcceptAll?.();
    if (input === 's' || input === 'S') onRejectAll?.();
  }, [fileIdx, hunkIdx, totalHunks, files.length, onAccept, onReject, onAcceptAll, onRejectAll, onClose]));

  if (files.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={COLORS.textDim}>No diff to display.</Text>
      </Box>
    );
  }

  if (showHelp) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={COLORS.primary} bold>DiffView Help</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={COLORS.textDim}>↑ ↓ — navigate hunks</Text>
          <Text color={COLORS.textDim}>← → — navigate files</Text>
          <Text color={COLORS.textDim}>a — accept hunk</Text>
          <Text color={COLORS.textDim}>r — reject hunk</Text>
          <Text color={COLORS.textDim}>d — accept all hunks</Text>
          <Text color={COLORS.textDim}>s — reject all hunks</Text>
          <Text color={COLORS.textDim}>? — toggle help</Text>
          <Text color={COLORS.textDim}>Esc — close</Text>
        </Box>
      </Box>
    );
  }

  const lineColor = (type: HunkLine['type']) => {
    switch (type) {
      case 'add': return COLORS.success;
      case 'del': return COLORS.warning;
      default: return COLORS.text;
    }
  };

  const linePrefix = (type: HunkLine['type']) => {
    switch (type) {
      case 'add': return '+';
      case 'del': return '-';
      default: return ' ';
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="row" gap={1}>
        <Text color={COLORS.primary} bold>Diff</Text>
        <Text color={COLORS.textDim}>
          File {fileIdx + 1}/{files.length} — Hunk {hunkIdx + 1}/{totalHunks}
        </Text>
        {currentHunk && (
          <Text color={currentHunk.accepted ? COLORS.success : COLORS.warning}>
            [{currentHunk.accepted ? 'accepted' : 'rejected'}]
          </Text>
        )}
      </Box>
      {currentFile && (
        <Box marginTop={1}>
          <Text color={COLORS.textDim}>{currentFile.newPath}</Text>
        </Box>
      )}
      {currentHunk && (
        <Box marginTop={1} flexDirection="column">
          <Text color={COLORS.textDim}>{currentHunk.header}</Text>
          <Box flexDirection="column" marginTop={1}>
            {currentHunk.lines.map((l, i) => (
              <Box key={i}>
                <Text color={lineColor(l.type)}>
                  {linePrefix(l.type)}{l.content}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={COLORS.textDim}>
          ↑↓ hunk • ← → file • a/r accept/reject • d accept all • s reject all • ? help • Esc close
        </Text>
      </Box>
    </Box>
  );
};
