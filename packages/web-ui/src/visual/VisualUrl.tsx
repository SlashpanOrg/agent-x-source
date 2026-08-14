import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors, MONO } from '../theme';
import { isExternalHttpUrl, openExternalUrl } from '../utils/open-external-url';

const IFRAME_SANDBOX = [
  'allow-scripts',
  'allow-same-origin',
  'allow-forms',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
].join(' ');

export function VisualUrlCard({
  title,
  caption,
  url,
  compact = false,
}: {
  title: string;
  caption?: string;
  url: string;
  compact?: boolean;
}) {
  return (
    <Box
      sx={{
        p: compact ? 1.25 : 2,
        border: `1px solid ${colors.border.default}`,
        borderRadius: 1,
        bgcolor: colors.bg.primary,
      }}
    >
      <Typography sx={{ fontFamily: MONO, fontSize: compact ? '0.7rem' : '0.8rem', color: colors.text.primary, mb: 0.5 }}>
        {title}
      </Typography>
      {caption && (
        <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: colors.text.secondary, mb: 1 }}>
          {caption}
        </Typography>
      )}
      <Typography
        component="button"
        type="button"
        onClick={() => openExternalUrl(url)}
        sx={{
          all: 'unset',
          cursor: 'pointer',
          fontFamily: MONO,
          fontSize: '0.65rem',
          color: colors.accent.blue,
          wordBreak: 'break-all',
          '&:hover': { color: colors.text.primary },
        }}
      >
        {url}
      </Typography>
    </Box>
  );
}

/** Live page preview for the voice / crew visual stage only. */
export function VisualUrlFrame({ title, url }: { title: string; url: string }) {
  if (!isExternalHttpUrl(url)) {
    return <VisualUrlCard title={title} url={url} />;
  }
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: 'min(68vh, 720px)',
        bgcolor: colors.bg.primary,
        border: `1px solid ${colors.border.default}`,
        overflow: 'hidden',
      }}
    >
      <Box
        component="iframe"
        src={url}
        title={title}
        sandbox={IFRAME_SANDBOX}
        referrerPolicy="no-referrer-when-downgrade"
        sx={{
          display: 'block',
          flex: 1,
          width: '100%',
          minHeight: 0,
          border: 0,
          bgcolor: '#fff',
        }}
      />
      <Typography
        sx={{
          fontFamily: MONO,
          fontSize: '0.5rem',
          color: colors.text.dim,
          px: 1.25,
          py: 0.5,
          borderTop: `1px solid ${colors.border.default}`,
        }}
      >
        If the page is blank it may block embedding — open it in the browser.
      </Typography>
    </Box>
  );
}
