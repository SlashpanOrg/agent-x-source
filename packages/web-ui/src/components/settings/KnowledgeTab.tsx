import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import DownloadIcon from '@mui/icons-material/Download';
import { SettingsCard } from './SettingsCard';
import { settingsTheme, settingsHelperSx } from '../../styles/settings-theme';
import { colors, alphaColor } from '../../theme';
import { knowledgeBase } from '../../api';
import { OcrStackInstallButton } from '../OcrStackInstallButton';

const MONO = "'JetBrains Mono', monospace";

interface ParserMeta {
  id: string;
  name: string;
  description: string;
  package: string;
}

const PARSERS: ParserMeta[] = [
  {
    id: 'marker',
    name: 'Marker',
    description: 'High-accuracy PDF to markdown conversion.',
    package: 'marker-pdf',
  },
  {
    id: 'docling',
    name: 'Docling',
    description: 'Layout-aware document parsing for PDFs and DOCX.',
    package: 'docling',
  },
];

interface ParserState {
  id: string;
  installed: boolean;
  version?: string;
  installing: boolean;
  error?: string;
}

/** Compact parser install/status block — lives under Settings → General. */
export function DocumentParsersSection() {
  const [parsers, setParsers] = useState<ParserState[]>(
    PARSERS.map((p) => ({ id: p.id, installed: false, installing: false })),
  );
  const [checking, setChecking] = useState(true);

  const loadStatus = useCallback(async () => {
    setChecking(true);
    try {
      const status = await knowledgeBase.parserStatus();
      setParsers((prev) =>
        prev.map((p) => {
          const s = status.find((x) => x.id === p.id);
          return { ...p, installed: s?.installed ?? false, version: s?.version };
        }),
      );
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const install = async (id: string) => {
    setParsers((prev) => prev.map((p) => (p.id === id ? { ...p, installing: true, error: undefined } : p)));
    try {
      const result = await knowledgeBase.installParser(id);
      setParsers((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                installed: result.success,
                version: result.version,
                installing: false,
                error: result.success ? undefined : result.message,
              }
            : p,
        ),
      );
    } catch (err) {
      setParsers((prev) =>
        prev.map((p) =>
          p.id === id
            ? { ...p, installing: false, error: err instanceof Error ? err.message : String(err) }
            : p,
        ),
      );
    }
  };

  return (
    <SettingsCard title="Document parsers" subtitle="Optional — not required for normal use">
      <Typography sx={{ ...settingsHelperSx, mb: 1.25 }}>
        Scanned or image-only PDFs need Tesseract + Poppler. The button installs them in the background on macOS, Linux, and Windows.
      </Typography>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 1.5,
          p: 1,
          mb: 1.25,
          bgcolor: settingsTheme.bg.panel,
          border: `1px solid ${settingsTheme.border.default}`,
          borderRadius: 1,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: settingsTheme.text.primary }}>
            PDF OCR
          </Typography>
          <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.text.secondary }}>
            Required to ingest scanned or outlined PDFs (Tesseract + Poppler).
          </Typography>
          <OcrStackInstallButton showWhenInstalled />
        </Box>
      </Box>
      <Typography sx={{ ...settingsHelperSx, mb: 1.25 }}>
        Install layout-aware PDF/DOCX parsers when you need higher-quality extraction.
      </Typography>

      {checking && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <CircularProgress size={14} sx={{ color: settingsTheme.text.dim }} />
          <Typography sx={{ ...settingsHelperSx, mb: 0 }}>Checking status…</Typography>
        </Box>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {PARSERS.map((meta) => {
          const state = parsers.find((p) => p.id === meta.id) as ParserState;
          return (
            <Box
              key={meta.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1.5,
                p: 1,
                bgcolor: settingsTheme.bg.panel,
                border: `1px solid ${settingsTheme.border.default}`,
                borderRadius: 1,
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                  <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: settingsTheme.text.primary }}>
                    {meta.name}
                  </Typography>
                  <Chip
                    label={state.installed ? 'Installed' : 'Not installed'}
                    size="small"
                    sx={{
                      height: 16,
                      fontSize: '0.55rem',
                      fontFamily: MONO,
                      color: state.installed ? colors.accent.green : colors.accent.orange,
                      bgcolor: state.installed
                        ? alphaColor(colors.accent.green, 0.1)
                        : alphaColor(colors.accent.orange, 0.1),
                      border: `1px solid ${
                        state.installed
                          ? alphaColor(colors.accent.green, 0.25)
                          : alphaColor(colors.accent.orange, 0.25)
                      }`,
                    }}
                  />
                </Box>
                <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.text.secondary }}>
                  {meta.description}
                </Typography>
                {state.version && (
                  <Typography sx={{ fontSize: '0.6rem', color: settingsTheme.text.dim, fontFamily: MONO }}>
                    {state.version}
                  </Typography>
                )}
                {state.error && (
                  <Typography sx={{ fontSize: '0.6rem', color: colors.accent.red, mt: 0.25 }}>
                    {state.error}
                  </Typography>
                )}
              </Box>

              {!state.installed && (
                <Button
                  variant="outlined"
                  size="small"
                  disabled={state.installing}
                  startIcon={
                    state.installing ? (
                      <CircularProgress size={12} sx={{ color: 'inherit' }} />
                    ) : (
                      <DownloadIcon sx={{ fontSize: 14 }} />
                    )
                  }
                  onClick={() => void install(meta.id)}
                  sx={{
                    minWidth: 90,
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
                  {state.installing ? 'Installing…' : 'Install'}
                </Button>
              )}
            </Box>
          );
        })}
      </Box>
    </SettingsCard>
  );
}
