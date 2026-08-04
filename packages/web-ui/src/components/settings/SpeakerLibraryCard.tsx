import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import type { SpeakerProfile } from '@agentx/shared';
import { voice } from '../../api';
import { useMicrophonePermission } from '../../hooks/useMicrophonePermission';
import {
  settingsBtnGhostSx,
  settingsBtnPrimarySx,
  settingsHelperSx,
  settingsTheme,
} from '../../styles/settings-theme';
import { SettingsCard } from './SettingsCard';
import { SpeakerProfileRow } from './SpeakerProfileRow';
import { AddSpeakerProfileModal } from './AddSpeakerProfileModal';
import { SpeakerProfileModal } from './SpeakerProfileModal';

interface SpeakerLibraryCardProps {
  ecapaInstalled: boolean;
}

export function SpeakerLibraryCard({ ecapaInstalled }: SpeakerLibraryCardProps) {
  const [profiles, setProfiles] = useState<SpeakerProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [addSampleProfileId, setAddSampleProfileId] = useState<string | null>(null);
  const [addSampleProfileName, setAddSampleProfileName] = useState<string>('');
  const [isRequestingMic, setIsRequestingMic] = useState(false);
  const { requestAccess } = useMicrophonePermission();

  const refresh = useCallback(async () => {
    try {
      const res = await voice.speakers();
      setProfiles(res.profiles ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load voiceprints');
    }
  }, []);

  useEffect(() => {
    if (ecapaInstalled) {
      void refresh();
    }
  }, [ecapaInstalled, refresh]);

  const profile = selectedProfileId ? profiles.find((p) => p.id === selectedProfileId) : undefined;

  const handleAdd = async () => {
    setMicError(null);
    setIsRequestingMic(true);
    try {
      const granted = await requestAccess();
      if (granted) {
        setSelectedProfileId(null);
        setAddSampleProfileId(null);
        setAddSampleProfileName('');
        setModalOpen(true);
      } else {
        setMicError('Microphone access is required to record a voice profile.');
      }
    } catch (err) {
      setMicError(err instanceof Error ? err.message : 'Microphone access request failed');
    } finally {
      setIsRequestingMic(false);
    }
  };

  const handleReset = async () => {
    try {
      setLoading(true);
      await voice.resetSpeakers();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset voiceprints');
    } finally {
      setLoading(false);
    }
  };

  if (!ecapaInstalled) {
    return (
      <SettingsCard title="Voice Prints" subtitle="Speaker ID">
        <Typography sx={{ ...settingsHelperSx, fontSize: '0.65rem', color: settingsTheme.text.dim }}>
          Install the ECAPA voiceprint model to manage speaker profiles.
        </Typography>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard title="Voice Prints" subtitle="Speaker ID">
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Button
          onClick={() => void handleAdd()}
          disabled={loading || isRequestingMic}
          startIcon={isRequestingMic ? (
            <CircularProgress size={14} color="inherit" />
          ) : (
            <AddIcon sx={{ fontSize: 14 }} />
          )}
          sx={{ ...settingsBtnPrimarySx, fontSize: '0.62rem', py: 0.45 }}
        >
          Add Voice Profile
        </Button>
        {profiles.length > 0 && (
          <Button
            onClick={() => void handleReset()}
            disabled={loading}
            startIcon={<DeleteSweepIcon sx={{ fontSize: 14 }} />}
            sx={{ ...settingsBtnGhostSx, fontSize: '0.62rem', py: 0.3, px: 1 }}
          >
            Reset all
          </Button>
        )}
      </Box>

      {error && (
        <Typography sx={{ ...settingsHelperSx, fontSize: '0.6rem', color: settingsTheme.accent.alert, mb: 1 }}>
          {error}
        </Typography>
      )}

      {micError && (
        <Typography sx={{ ...settingsHelperSx, fontSize: '0.6rem', color: settingsTheme.accent.alert, mb: 1 }}>
          {micError}
        </Typography>
      )}

      {profiles.length === 0 ? (
        <Typography sx={{ ...settingsHelperSx, fontSize: '0.65rem', color: settingsTheme.text.dim }}>
          No voiceprints yet. Click "Add Voice Profile" to enrol a speaker.
        </Typography>
      ) : (
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
          gap: 1,
        }}>
          {profiles.map((p) => (
            <SpeakerProfileRow
              key={p.id}
              profile={p}
              onSelect={setSelectedProfileId}
            />
          ))}
        </Box>
      )}

      <AddSpeakerProfileModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setAddSampleProfileId(null);
          setAddSampleProfileName('');
        }}
        onSaved={() => { setModalOpen(false); setAddSampleProfileId(null); setAddSampleProfileName(''); void refresh(); }}
        profileId={addSampleProfileId ?? undefined}
        profileName={addSampleProfileName}
      />

      <SpeakerProfileModal
        open={Boolean(selectedProfileId)}
        profileId={selectedProfileId}
        onClose={() => setSelectedProfileId(null)}
        onUpdated={() => void refresh()}
        onAddSample={() => {
          if (selectedProfileId) {
            setAddSampleProfileId(selectedProfileId);
            setAddSampleProfileName(profile?.name ?? '');
            setSelectedProfileId(null);
            setModalOpen(true);
          }
        }}
      />
    </SettingsCard>
  );
}
