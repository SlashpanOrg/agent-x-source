import React from 'react';
import { Box, Text } from 'ink';

export const ActivityGroup: React.FC<{
  toolNames: string[];
}> = ({ toolNames }) => {
  if (toolNames.length === 0) return null;

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color="#8b949e" dimColor>
          ⚡ Activity: {toolNames.length} tools
        </Text>
      </Box>
      <Box marginLeft={2} flexDirection="row" flexWrap="wrap">
        <Text color="#484f58" dimColor>
          {toolNames.join(', ')}
        </Text>
      </Box>
    </Box>
  );
};
