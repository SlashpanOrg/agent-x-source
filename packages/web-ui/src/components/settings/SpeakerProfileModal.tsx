import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Modal from '@mui/material/Modal';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import MicIcon from '@mui/icons-material/Mic';
import type { SpeakerProfile } from '@agentx/shared';
import { voice } from '../../api';
import {
  settingsBtnGhostSx,
  settingsBtnPrimarySx,
  settingsHelperSx,
  settingsTheme,
} from '../../styles/settings-theme';

interface SpeakerProfileModalProps {
  open: boolean;
  profileId: string | null;
  onClose: () => void;
  onUpdated: () => void;
  onAddSample?: (profileId: string) => void;
}

export function SpeakerProfileModal({
  open,
  profileId,
  onClose,
  onUpdated,
  onAddSample,
}: SpeakerProfileModalProps) {
  const [profile, setProfile] = useState<SpeakerProfile | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !profileId) {
      setProfile(null);
      return;
    }
    voice.speakers()
      .then((res) => {
        const found = res.profiles.find((p) => p.id === profileId);
        if (found) {
          setProfile(found);
          setName(found.name);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load profile'));
  }, [open, profileId]);

  const handleSaveName = async () => {
    if (!profile || !name.trim() || name.trim() === profile.name) return;
    setSaving(true);
    try {
      await voice.updateSpeaker(profile.id, name.trim());
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename profile');
    } finally {
      setSaving(false);
    }
  };

  const handleSetRoot = async () => {
    if (!profile) return;
    try {
      await voice.setRootSpeaker(profile.id);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set root');
    }
  };

  const handleDelete = async () => {
    if (!profile) return;
    try {
      await voice.deleteSpeaker(profile.id);
      onUpdated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete profile');
    }
  };

  const handleDeleteSample = async (sampleId: string) => {
    if (!profile) return;
    try {
      await voice.deleteSpeakerSample(profile.id, sampleId);
      const remaining = (profile.samples ?? []).filter((s) => s.id !== sampleId);
      setProfile({ ...profile, samples: remaining });
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete sample');
    }
  };

  const samples = profile?.samples?.length
    ? profile.samples
    : profile?.sampleB64
      ? [{ id: profile.id, createdAt: profile.createdAt }]
      : [];

  return (
    <Modal open={open} onClose={onClose}>
      <Box sx={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: { xs: '90vw', sm: 420 },
        maxHeight: '90vh',
        overflow: 'auto',
        bgcolor: settingsTheme.bg.elevated,
        border: `1px solid ${settingsTheme.border.default}`,
        borderRadius: 1.5,
        boxShadow: 24,
        p: 2.5,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography sx={{ ...settingsHelperSx, fontSize: '0.85rem', color: settingsTheme.text.primary, fontWeight: 600 }}>
            Voice Profile
          </Typography>
          <IconButton onClick={onClose} sx={{ color: settingsTheme.text.dim, p: 0.5 }}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>

        {error && (
          <Typography sx={{ ...settingsHelperSx, fontSize: '0.6rem', color: settingsTheme.accent.alert, mb: 1 }}>
            {error}
          </Typography>
        )}

        {profile && (
          <>
            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <TextField
                fullWidth
                size="small"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveName(); }}
                sx={{ '& .MuiInputBase-root': { fontSize: '0.7rem' } }}
              />
              <Button
                onClick={() => void handleSaveName()}
                disabled={saving || !name.trim() || name.trim() === profile.name}
                sx={{ ...settingsBtnPrimarySx, fontSize: '0.6rem', py: 0.45, whiteSpace: 'nowrap' }}
              >
                Save
              </Button>
            </Box>

            {!profile.isRoot && (
              <Button
                onClick={() => void handleSetRoot()}
                fullWidth
                sx={{ ...settingsBtnGhostSx, fontSize: '0.6rem', py: 0.45, mb: 1 }}
              >
                Set as Root
              </Button>
            )}

            <Box sx={{ mb: 1.5 }}>
              <Typography sx={{ ...settingsHelperSx, fontSize: '0.65rem', color: settingsTheme.text.dim, mb: 0.5 }}>
                Samples ({samples.length})
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {samples.map((sample) => (
                  <Box key={sample.id} sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    p: 0.75,
                    border: `1px solid ${settingsTheme.border.default}`,
                    borderRadius: 0.75,
                    bgcolor: `${settingsTheme.bg.panel}80`,
                  }}>
                    <Typography sx={{ fontSize: '0.6rem', color: settingsTheme.text.secondary }}>
                      {sample.createdAt ? new Date(sample.createdAt).toLocaleString() : 'Unknown date'}
                    </Typography>
                    <IconButton
                      size="small"
                      onClick={() => void handleDeleteSample(sample.id)}
                      sx={{ color: settingsTheme.accent.alert, p: 0.4 }}
                    >
                      <DeleteIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Box>
                ))}
              </Box>
            </Box>

            {onAddSample && (
              <Button
                onClick={() => onAddSample(profile.id)}
                fullWidth
                startIcon={<MicIcon sx={{ fontSize: 14 }} />}
                sx={{ ...settingsBtnPrimarySx, fontSize: '0.6rem', py: 0.45, mb: 1 }}
              >
                Add sample
              </Button>
            )}

            <Button
              onClick={() => void handleDelete()}
              fullWidth
              startIcon={<DeleteIcon sx={{ fontSize: 14 }} />}
              sx={{ ...settingsBtnGhostSx, fontSize: '0.6rem', py: 0.45, color: settingsTheme.accent.alert }}
            >
              Delete profile
            </Button>
          </>
        )}
      </Box>
    </Modal>
  );
}
