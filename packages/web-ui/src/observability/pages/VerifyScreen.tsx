/** Verify screen (§11.9) — password input → verify → enable → reload.
 *
 * Shown inline when a user navigates to the Config page without Developer
 * Mode enabled. After successful verification, navigates to /config.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import LockIcon from '@mui/icons-material/Lock';
import { verifyDev, enableDev } from '../api';
import { obs, obsMonoSx, obsOverlineSx, obsBtnPrimarySx, obsInputSx, obsScanlineSx } from '../obs-theme';
import { alphaColor } from '../../theme';

export function VerifyScreen() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!password) return;
    setLoading(true);
    setError('');
    try {
      await verifyDev(password);
      await enableDev();
      // Navigate to config page (where the user was trying to go) and reload
      // so the dev mode state is picked up.
      navigate('/config');
      window.location.reload();
    } catch (e: unknown) {
      const err = e as { status?: number; code?: string; message?: string };
      if (err.status === 429) setError('Too many attempts. Try again in 5 minutes.');
      else if (err.status === 401) setError('Incorrect password.');
      else setError(err.message ?? 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100%', p: 2 }}>
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          maxWidth: 380,
          bgcolor: obs.bg.panel,
          border: `1px solid ${obs.border.hud}`,
          borderRadius: '10px',
          boxShadow: `0 0 40px ${alphaColor(obs.accent.hud, 0.1)}`,
          overflow: 'hidden',
        }}
      >
        <Box sx={obsScanlineSx} />
        <Box sx={{ position: 'relative', zIndex: 1, p: 3.5 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 2.5 }}>
            <Box
              sx={{
                width: 48, height: 48, borderRadius: '50%', mb: 1.5,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `1px solid ${obs.border.hud}`,
                bgcolor: alphaColor(obs.accent.hud, 0.08),
              }}
            >
              <LockIcon sx={{ fontSize: 22, color: obs.accent.hud }} />
            </Box>
            <Typography sx={{ ...obsOverlineSx, fontSize: '0.72rem', color: obs.text.primary, letterSpacing: '2px' }}>
              Developer Mode Required
            </Typography>
            <Typography sx={{ ...obsMonoSx, fontSize: '0.62rem', color: obs.text.dim, mt: 0.75, textAlign: 'center', lineHeight: 1.6 }}>
              Configuration changes require root credential verification.
            </Typography>
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 2, bgcolor: alphaColor(obs.accent.alert, 0.1), border: `1px solid ${alphaColor(obs.accent.alert, 0.35)}` }}>
              {error}
            </Alert>
          )}

          <TextField
            type="password"
            fullWidth
            label="Root password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            disabled={loading}
            autoFocus
            sx={{ mb: 2, ...obsInputSx }}
          />
          <Button
            fullWidth
            onClick={submit}
            disabled={loading || !password}
            sx={{ ...obsBtnPrimarySx, py: 1, fontSize: '0.68rem' }}
          >
            {loading ? <CircularProgress size={14} sx={{ color: obs.bg.void }} /> : 'Verify & Enable'}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
