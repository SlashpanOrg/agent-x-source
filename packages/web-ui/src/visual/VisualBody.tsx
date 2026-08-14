import { useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import type { VisualItem } from '@agentx/shared/browser';
import { colors, MONO, alphaColor } from '../theme';
import { PdfPagesView } from './PdfPagesView';
import { useAttachmentBlob } from './use-attachment-blob';
import { VisualUrlCard, VisualUrlFrame } from './VisualUrl';

export function VisualBody({
  item,
  compact = false,
  embedUrl = false,
}: {
  item: VisualItem;
  compact?: boolean;
  /** Voice / crew modal only — load http(s) pages in an iframe. */
  embedUrl?: boolean;
}) {
  const storageId = 'storageId' in item.source ? item.source.storageId : undefined;
  const url = 'url' in item.source ? item.source.url : undefined;
  const { blobUrl, bytes, mimeType, error, loading } = useAttachmentBlob(storageId, item.mimeType);
  const mime = mimeType || item.mimeType;
  const imageSrc = blobUrl || (item.kind === 'image' ? url : undefined);
  const videoSrc = blobUrl || (item.kind === 'video' ? url : undefined);
  const [mediaFailed, setMediaFailed] = useState(false);

  if (item.kind === 'url' && url) {
    return embedUrl
      ? <VisualUrlFrame title={item.title} url={url} />
      : <VisualUrlCard title={item.title} caption={item.caption} url={url} compact={compact} />;
  }

  if (loading && !url) {
    return (
      <Box sx={{ p: compact ? 2 : 4, textAlign: 'center' }}>
        <CircularProgress size={22} sx={{ color: colors.accent.cyan }} />
      </Box>
    );
  }

  if (error && !url) {
    return (
      <Typography sx={{ fontFamily: MONO, fontSize: '0.75rem', color: colors.accent.red, p: 2 }}>
        {error}
      </Typography>
    );
  }

  if (item.kind === 'image' && imageSrc && !mediaFailed) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: compact ? 120 : 200,
          maxHeight: compact ? 'min(48vh, 420px)' : 'min(72vh, 780px)',
          overflow: 'auto',
          bgcolor: colors.bg.primary,
          borderRadius: 1,
          border: `1px solid ${colors.border.default}`,
          p: 1.5,
        }}
      >
        <img
          src={imageSrc}
          alt={item.title}
          onError={() => setMediaFailed(true)}
          style={{
            maxWidth: '100%',
            maxHeight: compact ? 'min(46vh, 400px)' : 'min(70vh, 760px)',
            objectFit: 'contain',
          }}
        />
      </Box>
    );
  }

  if (item.kind === 'video' && videoSrc && !mediaFailed) {
    return (
      <Box
        sx={{
          bgcolor: colors.bg.primary,
          borderRadius: 1,
          border: `1px solid ${colors.border.default}`,
          overflow: 'hidden',
        }}
      >
        <video
          src={videoSrc}
          controls
          playsInline
          onError={() => setMediaFailed(true)}
          style={{ width: '100%', maxHeight: compact ? 'min(48vh, 420px)' : 'min(70vh, 760px)', background: '#000' }}
        />
      </Box>
    );
  }

  if ((item.kind === 'document' || mime === 'application/pdf') && bytes) {
    return <PdfPagesView bytes={bytes} name={item.title} compact={compact} />;
  }

  if (item.kind === 'document' && blobUrl) {
    return (
      <Box
        sx={{
          p: 2,
          border: `1px solid ${colors.border.default}`,
          borderRadius: 1,
          bgcolor: alphaColor(colors.bg.primary, '80'),
        }}
      >
        <Typography sx={{ fontFamily: MONO, fontSize: '0.75rem', color: colors.text.secondary }}>
          {item.title}
          {mime ? ` · ${mime}` : ''}
        </Typography>
        {item.caption && (
          <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: colors.text.dim, mt: 0.75 }}>
            {item.caption}
          </Typography>
        )}
      </Box>
    );
  }

  if ((item.kind === 'image' || item.kind === 'video' || item.kind === 'document') && url) {
    return embedUrl
      ? <VisualUrlFrame title={item.title} url={url} />
      : <VisualUrlCard title={item.title} caption={item.caption} url={url} compact={compact} />;
  }

  return (
    <Typography sx={{ fontFamily: MONO, fontSize: '0.75rem', color: colors.text.dim, p: 2 }}>
      Nothing to display
    </Typography>
  );
}
