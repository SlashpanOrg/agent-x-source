/**
 * Neural Cortex step for the setup wizard.
 *
 * Progress-only: auto-starts embedding download with RAM-tier messaging.
 * Continue / Skip live in the wizard bottom nav (not inside this card).
 */
import { useState } from 'react';
import Box from '@mui/material/Box';
import { resolveNeuralCortexEmbeddingTier } from '@agentx/shared/browser';
import { EmbeddingModelDownload } from '../EmbeddingModelDownload';
import { SpeakerModelDownload } from './SpeakerModelDownload';
import { WizardStepHeader } from './wizard-ui';

export interface WizardNeuralStepProps {
  /** Total system RAM in GB (for tier resolution). */
  totalMemoryGB?: number;
  /** Fired when both the embedding model and the ECAPA voiceprint model are ready. */
  onReadyChange?: (ready: boolean) => void;
  /**
   * Fired when the embedding model download fails because the model is no longer available
   * from the endpoint. The wizard uses this to offer a "Continue without Neural Core" path
   * and silently leave the cortex in degraded mode.
   */
  onAvailabilityErrorChange?: (hasAvailabilityError: boolean) => void;
}

const TIER_COPY = {
  'bge-m3': {
    subtitle: 'Awakening the full neural core for this vessel.',
  },
  minilm: {
    subtitle: 'Bringing the neural core online for this voyage.',
    headline: 'Standard Neural Link',
    body: 'Your agent is ready to serve. On a more capable platform, Agent-X will reach even greater heights.',
  },
} as const;

export function WizardNeuralStep({ totalMemoryGB, onReadyChange, onAvailabilityErrorChange }: WizardNeuralStepProps) {
  const tier = resolveNeuralCortexEmbeddingTier(totalMemoryGB ?? 0);
  const copy = TIER_COPY[tier];
  const [embedReady, setEmbedReady] = useState(false);
  const [ecapaReady, setEcapaReady] = useState(false);

  const handleEmbedReady = (ready: boolean) => {
    setEmbedReady(ready);
    onReadyChange?.(ready && ecapaReady);
  };

  const handleEcapaReady = (ready: boolean) => {
    setEcapaReady(ready);
    onReadyChange?.(embedReady && ready);
  };

  return (
    <Box>
      <WizardStepHeader
        codename="MODULE · NEURAL CORTEX"
        title="Neural Cortex Initialization"
        subtitle={copy.subtitle}
      />

      <EmbeddingModelDownload
        onReadyChange={handleEmbedReady}
        onAvailabilityErrorChange={onAvailabilityErrorChange}
        banner={tier === 'minilm' && 'headline' in copy
          ? { headline: copy.headline, body: copy.body }
          : undefined}
      />

      <SpeakerModelDownload onReadyChange={handleEcapaReady} />
    </Box>
  );
}
