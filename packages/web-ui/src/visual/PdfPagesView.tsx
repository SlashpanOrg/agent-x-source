import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { colors, MONO, alphaColor } from '../theme';

export function PdfPagesView({
  bytes,
  name,
  compact = false,
}: {
  bytes: ArrayBuffer;
  name: string;
  compact?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (host) host.replaceChildren();

    const run = async () => {
      setStatus('loading');
      setError(null);
      try {
        const pdfjs = await import('pdfjs-dist');
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

        const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
        if (cancelled) return;
        setPageCount(doc.numPages);

        const root = hostRef.current;
        if (!root) return;
        root.replaceChildren();

        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return;
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const maxWidth = Math.min(root.clientWidth || 720, compact ? 640 : 900);
          const scale = Math.min(compact ? 1.2 : 1.5, maxWidth / Math.max(base.width, 1));
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.setAttribute('aria-label', `${name} — page ${i}`);
          Object.assign(canvas.style, {
            width: '100%',
            height: 'auto',
            display: 'block',
            marginBottom: i < doc.numPages ? '12px' : '0',
            background: '#fff',
            borderRadius: '4px',
            boxShadow: `0 1px 0 ${alphaColor(colors.border.default, 0.8)}`,
          });
          root.appendChild(canvas);
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas unavailable');
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        }
        if (!cancelled) setStatus('ready');
      } catch (e) {
        if (!cancelled) {
          setStatus('error');
          setError(e instanceof Error ? e.message : 'Failed to render PDF');
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [bytes, name, compact]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minHeight: compact ? 120 : 200 }}>
      {status === 'loading' && (
        <Box sx={{ py: compact ? 2 : 4, textAlign: 'center' }}>
          <CircularProgress size={22} sx={{ color: colors.accent.cyan }} />
          <Typography sx={{ mt: 1, fontFamily: MONO, fontSize: '0.65rem', color: colors.text.dim }}>
            Rendering pages…
          </Typography>
        </Box>
      )}
      {status === 'error' && (
        <Typography color="error" sx={{ fontFamily: MONO, fontSize: '0.75rem', p: 2 }}>
          {error || 'Failed to render PDF'}
        </Typography>
      )}
      {status === 'ready' && pageCount > 0 && (
        <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: colors.text.dim, px: 0.5 }}>
          {pageCount} page{pageCount === 1 ? '' : 's'}
        </Typography>
      )}
      <Box
        ref={hostRef}
        sx={{
          overflow: 'auto',
          maxHeight: compact ? 'min(48vh, 420px)' : 'min(72vh, 780px)',
          px: 0.5,
          py: 0.5,
          bgcolor: colors.bg.primary,
          borderRadius: 1,
          border: `1px solid ${colors.border.default}`,
        }}
      />
    </Box>
  );
}
