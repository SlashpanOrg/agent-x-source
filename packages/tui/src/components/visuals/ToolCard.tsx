import React from 'react';
import { Box, Text } from 'ink';
import type { ToolCardProps } from '@agentx/shared';

const STATUS_ICONS: Record<string, string> = {
  pending: '~',
  running: '⟳',
  completed: '✓',
  error: '✗',
  denied: '—',
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#8b949e',
  running: '#58a6ff',
  completed: '#3fb950',
  error: '#f85149',
  denied: '#484f58',
};

export const ToolCard: React.FC<{ card: ToolCardProps }> = ({ card }) => {
  const icon = STATUS_ICONS[card.status] ?? '~';
  const color = STATUS_COLORS[card.status] ?? '#8b949e';
  const duration = card.durationMs ? ` (${card.durationMs}ms)` : '';

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={color}>
          {icon} {card.icon} {card.label}
        </Text>
        {card.detail ? <Text color="#8b949e"> {card.detail}</Text> : null}
        <Text color="#484f58">{duration}</Text>
      </Box>
      {card.error ? (
        <Box marginLeft={4}>
          <Text color="#f85149">Error: {card.error}</Text>
        </Box>
      ) : null}
    </Box>
  );
};
