import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import DownloadIcon from '@mui/icons-material/Download';
import { knowledgeBase } from '../api';
import { colors, alphaColor, MONO } from '../theme';

type ToolStatus = Awaited<ReturnType<typeof knowledgeBase.toolStatus>>[number];

export function errorNeedsOcrInstall(error: string | undefined): boolean {
  if (!error) return false;
  return /scanned pdf|ocr tools missing|tesseract not found|pdftoppm not found|poppler/i.test(error);
}

export function OcrStackInstallButton({
  compact = false,
  showWhenInstalled = false,
  onInstalled,
}: {
  compact?: boolean;
  showWhenInstalled?: boolean;
  onInstalled?: () => void;
}) {
  const [tool, setTool] = useState<ToolStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    const tools = await knowledgeBase.toolStatus();
    const next = tools.find((t) => t.id === 'ocr-stack') ?? null;
    setTool(next);
    return next;
  }, []);

  useEffect(() => {
    void refresh().catch(() => {});
  }, [refresh]);

  const install = async () => {
    setInstalling(true);
    setFailed(false);
    setMessage('Installing PDF OCR in the background…');
    try {
      let job = await knowledgeBase.installTool('ocr-stack');
      const deadline = Date.now() + 10 * 60 * 1000;
      while (job.status === 'installing' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        job = await knowledgeBase.installToolJob(job.id);
        setMessage(job.message);
      }
      const next = await refresh();
      if (job.status === 'ready' || next?.installed) {
        setFailed(false);
        setMessage(job.message || 'PDF OCR ready.');
        onInstalled?.();
      } else {
        setFailed(true);
        setMessage(job.message || 'Install failed.');
      }
    } catch (err) {
      setFailed(true);
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
    }
  };

  if (!tool) return null;
  if (tool.installed) {
    if (!showWhenInstalled) return null;
    return (
      <Typography sx={{ fontSize: '0.6rem', color: colors.accent.green, fontFamily: MONO, mt: compact ? 1 : 0.5 }}>
        Installed
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mt: compact ? 1 : 0 }}>
      <Button
        variant="outlined"
        size="small"
        disabled={installing}
        startIcon={
          installing ? (
            <CircularProgress size={12} sx={{ color: 'inherit' }} />
          ) : (
            <DownloadIcon sx={{ fontSize: 14 }} />
          )
        }
        onClick={() => void install()}
        sx={{
          alignSelf: 'flex-start',
          minWidth: compact ? 0 : 90,
          border: `1px solid ${colors.accent.blue}`,
          color: colors.accent.blue,
          fontSize: '0.65rem',
          textTransform: 'none',
          '&:hover': {
            borderColor: colors.accent.blue,
            bgcolor: alphaColor(colors.accent.blue, 0.12),
          },
        }}
      >
        {installing ? 'Installing…' : 'Install PDF OCR'}
      </Button>
      <Typography
        sx={{
          fontSize: '0.58rem',
          fontFamily: MONO,
          color: failed ? colors.accent.red : colors.text.dim,
          lineHeight: 1.4,
        }}
      >
        {message
          ?? (tool.canInstall
            ? `Missing ${tool.missing.join(' + ')}. Installs with ${tool.installer} in the background.`
            : tool.command
              ? `Needs admin. Run: ${tool.command}`
              : `Missing ${tool.missing.join(' + ')}. Install Tesseract and Poppler for this OS, then retry.`)}
      </Typography>
    </Box>
  );
}
