import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import { voice } from '../../api';
import { startVoiceAssetDownload, useVoiceAssetDownload } from '../../hooks/useVoiceAssetDownloads';
import { settingsBtnGhostSx, settingsHelperSx, settingsMonoSx, settingsTheme } from '../../styles/settings-theme';
import { colors } from '../../theme';

interface SpeakerModelDownloadProps {
  onReadyChange?: (ready: boolean) => void;
}

const ASSET_ID = 'speechbrain-ecapa';
const DISPLAY_NAME = 'SpeechBrain ECAPA';

export function SpeakerModelDownload({ onReadyChange }: SpeakerModelDownloadProps) {
  const [loading, setLoading] = useState(true);
  const [installed, setInstalled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const download = useVoiceAssetDownload(ASSET_ID);
  const isDownloading = download && (download.status === 'running' || download.status === 'pending' || download.status === 'verifying');
  const isDownloadError = download?.status === 'error';
  const isDownloadComplete = download?.status === 'complete';

  const checkInstalled = useCallback(async () => {
    try {
      const { assets } = await voice.installedAssets();
      const found = assets.some((a) => a.assetId === ASSET_ID);
      setInstalled(found);
      onReadyChange?.(found);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check ECAPA status');
    } finally {
      setLoading(false);
    }
  }, [onReadyChange]);

  useEffect(() => {
    void checkInstalled();
  }, [checkInstalled]);

  useEffect(() => {
    if (isDownloadComplete) {
      setInstalled(true);
      onReadyChange?.(true);
    }
  }, [isDownloadComplete, onReadyChange]);

  const handleDownload = async () => {
    setError(null);
    try {
      await startVoiceAssetDownload(ASSET_ID);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start ECAPA download');
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
        <CircularProgress size={16} sx={{ color: settingsTheme.accent.hud }} />
        <Typography sx={{ ...settingsMonoSx, fontSize: '0.65rem', color: settingsTheme.text.dim }}>
          Checking voiceprint model status…
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{
      p: 1.5,
      borderRadius: 1,
      bgcolor: colors.bg.primary,
      border: `1px solid ${colors.border.default}`,
      mt: 1.5,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, mb: 0.75 }}>
        <Box>
          <Typography sx={{ ...settingsMonoSx, fontSize: '0.72rem', color: settingsTheme.text.primary }}>
            {DISPLAY_NAME}
          </Typography>
          <Typography sx={{ ...settingsHelperSx, fontSize: '0.62rem', color: settingsTheme.text.dim }}>
            Speaker embedding model for voiceprint recognition. ~45 MB.
          </Typography>
        </Box>
        {installed ? (
          <Typography sx={{ ...settingsMonoSx, fontSize: '0.62rem', color: settingsTheme.accent.signal }}>
            Installed
          </Typography>
        ) : isDownloading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <CircularProgress size={14} sx={{ color: settingsTheme.accent.hud }} />
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.58rem', color: settingsTheme.text.dim }}>
              {Math.round(download?.progress ?? 0)}%
            </Typography>
          </Box>
        ) : (
          <Button
            onClick={handleDownload}
            sx={{ ...settingsBtnGhostSx, fontSize: '0.62rem', py: 0.3, px: 1 }}
          >
            Download
          </Button>
        )}
      </Box>

      {isDownloading && (
        <Box sx={{ mt: 0.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 0.25 }}>
            <Typography sx={{ ...settingsHelperSx, fontSize: '0.6rem' }}>
              {download?.detail ?? 'Downloading…'}
            </Typography>
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.6rem', color: settingsTheme.accent.hud }}>
              {Math.round(download?.progress ?? 0)}%
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={download?.progress ?? 0}
            sx={{
              height: 3,
              borderRadius: 1,
              bgcolor: settingsTheme.border.default,
              '& .MuiLinearProgress-bar': { bgcolor: settingsTheme.accent.hud },
            }}
          />
        </Box>
      )}

      {isDownloadError && download?.error && (
        <Typography sx={{ ...settingsHelperSx, fontSize: '0.58rem', color: settingsTheme.accent.alert, mt: 0.5 }}>
          {download.error}
        </Typography>
      )}

      {error && (
        <Typography sx={{ ...settingsHelperSx, fontSize: '0.58rem', color: settingsTheme.accent.alert, mt: 0.5 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}
