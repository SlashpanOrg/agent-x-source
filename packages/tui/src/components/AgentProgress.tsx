import { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';

interface AgentProgressProps {
  agentId: string;
  agentName: string;
  status: 'running' | 'complete' | 'failed' | 'cancelled';
  progress?: string;
  summary?: string;
  startedAt: number;
  endTime?: number;
}

const ORBIT_FRAMES = ['✦', '⊹', '∗', '⋆', '✧', '⋆', '∗', '⊹'];

export function AgentProgress({ agentName, status, progress, summary, startedAt, endTime }: AgentProgressProps) {
  const [frame, setFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (status !== 'running') return;
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % ORBIT_FRAMES.length);
      setElapsed(Date.now() - startedAt);
    }, 80);
    return () => clearInterval(interval);
  }, [status, startedAt]);

  const totalElapsed = endTime
    ? ((endTime - startedAt) / 1000).toFixed(1)
    : (elapsed / 1000).toFixed(1);

  const statusIcon = status === 'running' ? ORBIT_FRAMES[frame]
    : status === 'complete' ? '✓'
    : status === 'failed' ? '✗'
    : '○';

  const statusColor = status === 'running' ? COLORS.accent
    : status === 'complete' ? COLORS.success
    : status === 'failed' ? COLORS.error
    : COLORS.textDim;

  const label = status === 'running' ? `Satellite: ${agentName}`
    : status === 'complete' ? `Satellite docked: ${agentName}`
    : status === 'failed' ? `Satellite lost: ${agentName}`
    : agentName;

  return (
    <Box flexDirection="column" marginLeft={1} paddingY={0}>
      <Box gap={1}>
        <Text color={statusColor}>{statusIcon}</Text>
        <Text color={COLORS.primary} bold>{label}</Text>
        <Text color={COLORS.textDim}>{totalElapsed}s</Text>
        {status === 'complete' && summary && (
          <Text color={COLORS.textDim} wrap="truncate-end">— {summary}</Text>
        )}
      </Box>
      {progress && (
        <Box marginLeft={4}>
          <Text color={COLORS.textDim} wrap="truncate-end">{progress}</Text>
        </Box>
      )}
    </Box>
  );
}
