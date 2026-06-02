import React from 'react';
import { Box, Text } from 'ink';

export const StreamingText: React.FC<{
  stableHtml: string;
  unstableText: string;
  isStreaming: boolean;
}> = ({ stableHtml, unstableText, isStreaming }) => {
  const cursor = isStreaming ? (
    <Text color="#58a6ff">▍</Text>
  ) : null;

  return (
    <Box flexDirection="column">
      {stableHtml ? (
        <Box marginBottom={1}>
          <Text>{stableHtml}</Text>
        </Box>
      ) : null}
      <Box>
        <Text>{unstableText}</Text>
        {cursor}
      </Box>
    </Box>
  );
};
