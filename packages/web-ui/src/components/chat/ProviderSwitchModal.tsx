// ProviderSwitchModal.tsx — forces model selection when switching providers.
// Prevents cross-provider setup (provider-A active with model from provider-B).

import { useState, useEffect, useCallback } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import RadioGroup from '@mui/material/RadioGroup';
import Radio from '@mui/material/Radio';
import FormControlLabel from '@mui/material/FormControlLabel';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import { colors, alphaColor } from '../../theme';
import { providers, modelBenchmark, type ModelInfo } from '../../api';

export interface ProviderSwitchModalProps {
  open: boolean;
  /** The provider id (e.g. "xai", "openai", "ollama"). */
  providerId: string;
  /** Display label for the provider/profile. */
  providerLabel: string;
  /** Called when the user confirms a model. Receives the selected model id. */
  onConfirm: (modelId: string, contextWindow?: number) => void;
  /** Called when the user cancels — provider switch is rolled back. */
  onCancel: () => void;
}

export function ProviderSwitchModal({
  open,
  providerId,
  providerLabel,
  onConfirm,
  onCancel,
}: ProviderSwitchModalProps) {
  const [clearedModels, setClearedModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadModels = useCallback(async () => {
    if (!providerId) return;
    setLoading(true);
    setError(null);
    setSelectedModel('');
    try {
      const [all, cleared] = await Promise.all([
        providers.models(providerId),
        modelBenchmark.cleared(providerId).catch(() => ({ models: [] as Array<{ modelId: string }> })),
      ]);
      const allowed = new Set(cleared.models.map((m) => m.modelId));
      const filtered = all.filter((m) => allowed.has(m.id));
      setClearedModels(filtered);
      // Auto-select the first cleared model
      if (filtered.length > 0) {
        setSelectedModel(filtered[0].id);
      }
    } catch {
      setClearedModels([]);
      setError('Failed to load models for this provider.');
    } finally {
      setLoading(false);
    }
  }, [providerId]);

  useEffect(() => {
    if (open) {
      void loadModels();
    }
  }, [open, loadModels]);

  const handleConfirm = () => {
    if (!selectedModel) return;
    const modelInfo = clearedModels.find((m) => m.id === selectedModel);
    onConfirm(selectedModel, modelInfo?.contextWindow);
  };

  return (
    <Dialog
      open={open}
      onClose={(_, reason) => {
        if (reason !== 'backdropClick' && reason !== 'escapeKeyDown') {
          onCancel();
        }
      }}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: colors.bg.secondary,
          border: `1px solid ${colors.border.default}`,
          borderRadius: 2,
        },
      }}
    >
      <DialogTitle sx={{ fontSize: '0.85rem', fontWeight: 600, color: colors.text.primary }}>
        Select a Model for {providerLabel}
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim, mb: 2 }}>
          You switched to <strong style={{ color: colors.accent.blue }}>{providerLabel}</strong>.
          Choose a cleared model to activate it as the default. This prevents cross-provider mismatches.
        </Typography>

        {loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={20} sx={{ mr: 1 }} />
            <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim }}>Loading cleared models…</Typography>
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 1, fontSize: '0.7rem' }}>{error}</Alert>
        )}

        {!loading && !error && clearedModels.length === 0 && (
          <Alert severity="warning" sx={{ mt: 1, fontSize: '0.7rem' }}>
            No cleared models found for this provider. Run a benchmark in <strong>Providers</strong> to clear models for agentic use.
          </Alert>
        )}

        {!loading && !error && clearedModels.length > 0 && (
          <RadioGroup
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            sx={{ gap: 0.5 }}
          >
            {clearedModels.map((m) => {
              const caps = m.capabilities ?? [];
              const hasFC = caps.includes('function_calling');
              const hasVision = caps.includes('vision');
              const hasReasoning = caps.includes('reasoning');
              return (
                <FormControlLabel
                  key={m.id}
                  value={m.id}
                  control={<Radio size="small" sx={{ color: colors.accent.blue, '&.Mui-checked': { color: colors.accent.blue } }} />}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                      <Typography sx={{ fontSize: '0.72rem', fontWeight: selectedModel === m.id ? 600 : 400 }}>
                        {m.name || m.id}
                      </Typography>
                      {hasFC && <CapBadge label="FC" color={colors.accent.blue} />}
                      {hasVision && <CapBadge label="V" color={colors.accent.green} />}
                      {hasReasoning && <CapBadge label="R" color={colors.accent.purple} />}
                      {m.contextWindow && (
                        <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim }}>
                          {(m.contextWindow / 1000).toFixed(0)}k context
                        </Typography>
                      )}
                    </Box>
                  }
                  sx={{
                    m: 0,
                    p: 0.5,
                    borderRadius: 1,
                    border: `1px solid ${selectedModel === m.id ? alphaColor(colors.accent.blue, '40') : 'transparent'}`,
                    bgcolor: selectedModel === m.id ? alphaColor(colors.accent.blue, '8') : 'transparent',
                    '&:hover': { bgcolor: alphaColor(colors.accent.blue, '5') },
                  }}
                />
              );
            })}
          </RadioGroup>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 1.5 }}>
        <Button onClick={onCancel} size="small" sx={{ fontSize: '0.7rem', color: colors.text.dim }}>
          Cancel
        </Button>
        <Button
          onClick={handleConfirm}
          size="small"
          variant="contained"
          disabled={!selectedModel || loading}
          sx={{ fontSize: '0.7rem', bgcolor: colors.accent.blue, '&:hover': { bgcolor: alphaColor(colors.accent.blue, '80') } }}
        >
          Confirm & Switch
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CapBadge({ label, color }: { label: string; color: string }) {
  return (
    <Typography
      component="span"
      sx={{
        fontSize: '0.45rem',
        color,
        bgcolor: alphaColor(color, '18'),
        px: 0.4,
        py: 0.05,
        borderRadius: 0.5,
        fontWeight: 600,
      }}
    >
      {label}
    </Typography>
  );
}
