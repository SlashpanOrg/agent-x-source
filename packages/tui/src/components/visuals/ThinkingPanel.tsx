import React from 'react';
import { Box, Text } from 'ink';

export const ThinkingPanel: React.FC<{
  isActive: boolean;
  content: string;
  title?: string;
  isExpanded?: boolean;
}> = ({ isActive, content, title, isExpanded = true }) => {
  if (!content && !isActive) return null;

  const displayContent = content || '(thinking...)';
  const truncated = isExpanded
    ? displayContent
    : displayContent.slice(0, 120) + (displayContent.length > 120 ? '...' : '');
  const toggleIcon = isExpanded ? '▾' : '▸';
  const label = title || 'Thinking';

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color="#8b949e" dimColor>
          {isActive ? (
            <Text color="#58a6ff">⟳ </Text>
          ) : (
            <Text>{toggleIcon} </Text>
          )}
          {label} · {displayContent.length} chars
        </Text>
      </Box>
      {isActive || isExpanded ? (
        <Box marginLeft={4}>
          <Text color="#8b949e" dimColor>
            {truncated}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
};
