/** Trace export toolbar (§11.12) — format selector + download + copy + open as text. */
import { useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Snackbar from '@mui/material/Snackbar';
import DownloadIcon from '@mui/icons-material/Download';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DescriptionIcon from '@mui/icons-material/Description';
import { exportTrace, exportTracePreview } from '../api';
import { obs, obsMonoSx, obsOverlineSx } from '../obs-theme';
import { alphaColor } from '../../theme';

export function TraceExportBar({ traceId, capturePrompts }: { traceId: string; capturePrompts: boolean }) {
  const [format, setFormat] = useState<'json' | 'markdown'>('markdown');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewText, setPreviewText] = useState('');
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(false);

  const download = useCallback(async () => {
    setLoading(true);
    try {
      const text = await exportTrace(traceId, format);
      const ext = format === 'json' ? 'json' : 'md';
      const filename = `agentx-trace-${traceId}.${ext}`;
      // Try File System Access API (Chromium).
      const w = window as unknown as { showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle> };
      if (w.showSaveFilePicker) {
        const handle = await w.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: format === 'json' ? 'JSON' : 'Markdown', accept: { 'application/json': ['.json'], 'text/markdown': ['.md'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
        setToast(`Saved ${filename}`);
      } else {
        // Fallback: trigger a browser download.
        const blob = new Blob([text], { type: format === 'json' ? 'application/json' : 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
        setToast(`Downloaded ${filename}`);
      }
    } catch (e: unknown) {
      setToast(`Export failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [traceId, format]);

  const copyToClipboard = useCallback(async () => {
    setLoading(true);
    try {
      const text = await exportTracePreview(traceId, format);
      await navigator.clipboard.writeText(text);
      setToast(`Copied ${text.length} chars to clipboard`);
    } catch (e: unknown) {
      setToast(`Copy failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [traceId, format]);

  const openAsText = useCallback(async () => {
    setLoading(true);
    try {
      const text = await exportTracePreview(traceId, format);
      setPreviewText(text);
      setPreviewOpen(true);
    } catch (e: unknown) {
      setToast(`Preview failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [traceId, format]);

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <ToggleButtonGroup
        size="small"
        value={format}
        exclusive
        onChange={(_, v: 'json' | 'markdown' | null) => v && setFormat(v)}
      >
        <ToggleButton value="markdown">MD</ToggleButton>
        <ToggleButton value="json">JSON</ToggleButton>
      </ToggleButtonGroup>
      <Box
        component="span"
        sx={{
          ...obsMonoSx, fontSize: '0.56rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
          px: 0.6, py: 0.2, borderRadius: '3px',
          color: capturePrompts ? obs.accent.signal : obs.text.dim,
          border: `1px solid ${alphaColor(capturePrompts ? obs.accent.signal : obs.text.dim, 0.4)}`,
          bgcolor: alphaColor(capturePrompts ? obs.accent.signal : obs.text.dim, 0.1),
        }}
      >
        {capturePrompts ? 'Prompts visible' : 'Redacted'}
      </Box>
      <Tooltip title="Download">
        <IconButton size="small" onClick={download} disabled={loading} sx={{ color: obs.text.dim, '&:hover': { color: obs.accent.hud } }}><DownloadIcon sx={{ fontSize: 16 }} /></IconButton>
      </Tooltip>
      <Tooltip title="Copy to clipboard">
        <IconButton size="small" onClick={copyToClipboard} disabled={loading} sx={{ color: obs.text.dim, '&:hover': { color: obs.accent.hud } }}><ContentCopyIcon sx={{ fontSize: 16 }} /></IconButton>
      </Tooltip>
      <Tooltip title="Open as text">
        <IconButton size="small" onClick={openAsText} disabled={loading} sx={{ color: obs.text.dim, '&:hover': { color: obs.accent.hud } }}><DescriptionIcon sx={{ fontSize: 16 }} /></IconButton>
      </Tooltip>
      <Snackbar
        open={!!toast}
        autoHideDuration={3000}
        onClose={() => setToast('')}
        message={toast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} maxWidth="md" fullWidth PaperProps={{ sx: { bgcolor: obs.bg.void, border: `1px solid ${obs.border.default}` } }}>
        <DialogTitle sx={{ ...obsOverlineSx, fontSize: '0.68rem', color: obs.text.primary, borderBottom: `1px solid ${obs.border.subtle}` }}>
          Trace export preview ({format})
        </DialogTitle>
        <DialogContent>
          <Box component="pre" className="ax-scroll" sx={{ ...obsMonoSx, fontSize: '0.68rem', color: obs.text.secondary, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '70vh' }}>
            {previewText}
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  );
}
