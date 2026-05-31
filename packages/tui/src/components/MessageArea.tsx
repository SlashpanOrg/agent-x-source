import { type FC, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';
import type { Message, MessageRole } from '@agentx/shared';

interface MessageAreaProps {
  messages: Message[];
  streamingContent?: string;
  pendingDiff?: { tool: string; filePath: string; diff: string };
}

export const MessageArea: FC<MessageAreaProps> = ({ messages, streamingContent, pendingDiff }) => {
  const bottomRef = useRef<any>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {messages.map((message) => (
        <Box key={message.id} flexDirection="column" paddingX={1} marginBottom={1}>
          <MessageHeader role={message.role} timestamp={message.createdAt} elapsed={message.elapsed} tokenCost={message.tokenCost} />
          <Box paddingLeft={2}>
            {renderMessageContent(message)}
          </Box>
          {message.toolCalls && message.toolCalls.length > 0 && (
            <Box paddingLeft={2} marginTop={0}>
              <Text color={COLORS.textDim} dimColor>
                [{message.toolCalls.length} tool call{message.toolCalls.length > 1 ? 's' : ''}]
              </Text>
            </Box>
          )}
        </Box>
      ))}

      {pendingDiff && (
        <Box flexDirection="column" paddingX={1} marginBottom={1}>
          <Text color={COLORS.accent} bold>📝 Diff preview ({pendingDiff.filePath})</Text>
          <Box paddingLeft={2}>
            <Text color={COLORS.textDim} wrap="wrap" dimColor>
              {pendingDiff.diff.split('\n').slice(0, 20).map((line, i) => {
                const color = line.startsWith('+') ? COLORS.success
                  : line.startsWith('-') ? COLORS.error
                  : COLORS.textDim;
                return <Text key={i} color={color}>{line}</Text>;
              })}
            </Text>
            {pendingDiff.diff.split('\n').length > 20 && (
              <Text color={COLORS.textMuted}>... ({pendingDiff.diff.split('\n').length - 20} more lines)</Text>
            )}
          </Box>
        </Box>
      )}

      {streamingContent && (
        <Box flexDirection="column" paddingX={1}>
          <MessageHeader role="assistant" />
          <Box paddingLeft={2}>
            <Text color={COLORS.text} wrap="wrap">
              {streamingContent}
              <Text color={COLORS.primary}>▊</Text>
            </Text>
          </Box>
        </Box>
      )}

      <Box ref={bottomRef} />
    </Box>
  );
};

function renderMessageContent(message: Message) {
  const content = message.content;

  if (message.role === 'tool') {
    const isError = content.startsWith('✗');
    const trimmed = content.length > 30000 ? content.slice(0, 30000) + '\n… [truncated]' : content;

    if (isError) {
      return <Text color={COLORS.error}>{trimmed}</Text>;
    }

    const lines = trimmed.split('\n');
    const threshold = 200;

    if (lines.length > threshold) {
      const visible = lines.slice(0, threshold).join('\n');
      const hidden = lines.length - threshold;
      return (
        <Box flexDirection="column">
          <Text color={COLORS.text} wrap="wrap">{visible}</Text>
          <Text color={COLORS.textDim} dimColor>
            … [{hidden} more lines — use `/tools file_read` to view full output]
          </Text>
        </Box>
      );
    }

    return <Text color={COLORS.text} wrap="wrap">{trimmed}</Text>;
  }

  const trimmed = content.length > 50000 ? content.slice(0, 50000) + '\n… [truncated]' : content;
  return <Text color={COLORS.text} wrap="wrap">{trimmed}</Text>;
}

const MessageHeader: FC<{ role: MessageRole; timestamp?: string; elapsed?: number; tokenCost?: number }> = ({ role, timestamp, elapsed, tokenCost }) => {
  const roleConfig = getRoleConfig(role);

  return (
    <Box>
      <Text color={roleConfig.color} bold>{roleConfig.icon} {roleConfig.label}</Text>
      {timestamp && (
        <Text color={COLORS.textDim} dimColor>
          {' '}({formatTime(timestamp)})
        </Text>
      )}
      {elapsed != null && role === 'assistant' && (
        <Text color={COLORS.textDim} dimColor>
          {' '}• {formatElapsed(elapsed)}
        </Text>
      )}
      {tokenCost != null && tokenCost > 0 && role === 'assistant' && (
        <Text color={COLORS.warning}>
          {' '}[{tokenCost < 0.01 ? `${(tokenCost * 100).toFixed(2)}¢` : `$${tokenCost.toFixed(4)}`}]
        </Text>
      )}
    </Box>
  );
};

function getRoleConfig(role: MessageRole): { icon: string; label: string; color: string } {
  switch (role) {
    case 'user':
      return { icon: '▸', label: 'You', color: COLORS.info };
    case 'assistant':
      return { icon: '◆', label: 'Agent-X', color: COLORS.primary };
    case 'system':
      return { icon: '⚙', label: 'System', color: COLORS.textDim };
    case 'tool':
      return { icon: '⚡', label: 'Tool', color: COLORS.success };
    default:
      return { icon: '•', label: role, color: COLORS.textDim };
  }
}

function formatTime(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatElapsed(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}
