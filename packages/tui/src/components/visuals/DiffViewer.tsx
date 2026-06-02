import React from 'react';
import { Box, Text } from 'ink';

export const DiffViewer: React.FC<{
  diff: string;
  filetype?: string;
}> = ({ diff, filetype }) => {
  const lines = diff.split('\n');

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color="#8b949e" dimColor>
          {filetype || 'Diff'} · {lines.length} lines
        </Text>
      </Box>
      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        {lines.map((line, i) => {
          const isAdded = line.startsWith('+') && !line.startsWith('+++');
          const isRemoved = line.startsWith('-') && !line.startsWith('---');
          const isHeader = line.startsWith('@@');
          const color = isAdded ? '#3fb950' : isRemoved ? '#f85149' : isHeader ? '#58a6ff' : undefined;

          return (
            <Box key={i}>
              <Text color="#484f58" dimColor>
                {(i + 1).toString().padStart(3, ' ')} │{' '}
              </Text>
              <Text color={color}>{line}</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};
