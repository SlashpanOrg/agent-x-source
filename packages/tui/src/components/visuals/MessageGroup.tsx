import React from 'react';
import { Box, Text } from 'ink';

export interface MessageGroupFooter {
  tokensIn?: number;
  tokensOut?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
  contextPercent?: number;
  model?: string;
}

export const MessageGroup: React.FC<{
  role: 'assistant' | 'user';
  children: React.ReactNode;
  footer?: MessageGroupFooter;
}> = ({ role, children, footer }) => {
  const isAssistant = role === 'assistant';
  const roleLabel = isAssistant ? 'AI' : 'U';
  const roleColor = isAssistant ? '#58a6ff' : '#8b949e';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="row">
        <Box marginRight={1}>
          <Text color={roleColor} bold>
            [{roleLabel}]
          </Text>
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          {children}
        </Box>
      </Box>
      {footer ? (
        <Box marginLeft={2} marginTop={1}>
          <Text color="#484f58" dimColor>
            {[
              footer.tokensIn !== undefined && footer.tokensOut !== undefined
                ? `↑${footer.tokensIn.toLocaleString()} ↓${footer.tokensOut.toLocaleString()}`
                : null,
              footer.cacheRead !== undefined
                ? `R:${footer.cacheRead.toLocaleString()}${footer.cacheWrite ? ` W:${footer.cacheWrite.toLocaleString()}` : ''}`
                : null,
              footer.cost !== undefined ? `$${footer.cost.toFixed(4)}` : null,
              footer.contextPercent !== undefined
                ? `${footer.contextPercent}%`
                : null,
              footer.model ?? null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
};
