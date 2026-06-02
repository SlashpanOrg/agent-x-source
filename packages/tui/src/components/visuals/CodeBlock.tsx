import React from 'react';
import { Box, Text } from 'ink';

export const CodeBlock: React.FC<{
  language?: string;
  content: string;
  isStreaming?: boolean;
  maxLines?: number;
}> = ({ language, content, isStreaming, maxLines = 40 }) => {
  const lines = content.split('\n');
  const truncated = lines.slice(0, maxLines);
  const hasMore = lines.length > maxLines;

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color="#8b949e" dimColor>
          {language || 'text'} · {lines.length} lines
          {hasMore ? ` (showing ${maxLines})` : ''}
        </Text>
      </Box>
      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        {truncated.map((line, i) => (
          <Box key={i}>
            <Text color="#484f58" dimColor>
              {(i + 1).toString().padStart(3, ' ')} │{' '}
            </Text>
            <Text dimColor={isStreaming}>
              {line}
            </Text>
          </Box>
        ))}
        {hasMore ? (
          <Text color="#8b949e" dimColor>
            ... {lines.length - maxLines} more lines ...
          </Text>
        ) : null}
      </Box>
    </Box>
  );
};
