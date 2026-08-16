import { useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import type { ArticleRecord } from '@agentx/shared';
import { displayArticleTitle } from '@agentx/shared/browser';
import { ArticlePage, exportArticleToPdfBlob, savePdfBlob } from '../articles';
import { colors, MONO } from '../theme';

interface Props {
  document: ArticleRecord;
  content?: string;
  onBack?: () => void;
}

async function notifyArticle(type: 'checkpoint' | 'error', message: string): Promise<void> {
  const { notify } = await import('../components/NotificationToast');
  notify(type, message);
}

export function ArticleViewer({ document, content, onBack }: Props) {
  const [exporting, setExporting] = useState(false);
  const title = displayArticleTitle(document.title) || document.title;

  const handleExportPdf = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const blob = await exportArticleToPdfBlob(
        content ?? '',
        title,
        { createdAt: document.createdAt, sessionId: document.sessionId },
      );
      const safeTitle = title.replace(/[^\w\s-]/g, '').trim().slice(0, 80) || 'article';
      const saved = await savePdfBlob(blob, { defaultFilename: `${safeTitle}-${document.id.slice(-8)}.pdf` });
      if (saved) {
        void notifyArticle('checkpoint', `PDF saved${typeof saved === 'string' && saved.includes('/') ? `: ${saved}` : ''}`);
      }
    } catch (e) {
      void notifyArticle('error', e instanceof Error ? e.message : 'PDF export failed');
    } finally {
      setExporting(false);
    }
  }, [content, document.createdAt, document.id, document.sessionId, exporting, title]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{
        flexShrink: 0,
        px: 1.5,
        py: 0.75,
        borderBottom: `1px solid ${colors.border.default}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 1,
        bgcolor: colors.bg.secondary,
      }}>
        {onBack && (
          <Tooltip title="Back to list">
            <IconButton
              size="small"
              onClick={onBack}
              sx={{
                display: { xs: 'inline-flex', md: 'none' },
                mr: 'auto',
                color: colors.text.dim,
                p: 0.35,
                '&:hover': { color: colors.text.primary },
              }}
            >
              <ArrowBackIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
        <Button
          size="small"
          variant="outlined"
          disabled={exporting}
          onClick={() => void handleExportPdf()}
          startIcon={exporting ? <CircularProgress size={14} /> : <PictureAsPdfIcon sx={{ fontSize: 16 }} />}
          sx={{
            flexShrink: 0,
            fontSize: '0.62rem',
            fontFamily: MONO,
            borderColor: colors.border.default,
            color: colors.text.secondary,
            '&:hover': { borderColor: colors.text.dim, color: colors.text.primary },
          }}
        >
          {exporting ? 'Exporting…' : 'Save as PDF'}
        </Button>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', bgcolor: colors.bg.primary, p: { xs: 1, sm: 1.25, md: 1.5 } }}>
        <ArticlePage
          content={content ?? ''}
          title={title}
          createdAt={document.createdAt}
          sessionId={document.sessionId}
          kind={document.contentFormat}
        />
      </Box>
    </Box>
  );
}
