import { type FC } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';
import { TokenBar } from './TokenBar.js';

interface BackgroundTask {
  id: string;
  name: string;
  elapsed: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress?: string;
}

interface SessionPanelProps {
  sessionId: string;
  provider: string;
  model: string;
  crewName?: string;
  scopePath?: string;
  tokensUsed: number;
  tokensTotal: number;
  isProcessing?: boolean;
  backgroundTasks?: BackgroundTask[];
  messageCount?: number;
  sessionCreatedAt?: string;
  totalCost?: number;
  watcherCount?: number;
  schedulerCount?: number;
}

export const SessionPanel: FC<SessionPanelProps> = ({
  sessionId,
  scopePath,
  tokensUsed,
  tokensTotal,
  backgroundTasks = [],
  messageCount,
  sessionCreatedAt,
  totalCost = 0,
  watcherCount = 0,
  schedulerCount = 0,
}) => {
  const shortPath = scopePath ? (scopePath.length > 40 ? '…' + scopePath.slice(-39) : scopePath) : '';
  const duration = sessionCreatedAt
    ? formatDuration(Math.floor((Date.now() - new Date(sessionCreatedAt).getTime()) / 1000))
    : '';
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={COLORS.border}
      paddingX={1}
    >
      <Row label="Session" value={sessionId} />
      {shortPath && <Row label="Path" value={shortPath} />}
      <Box gap={2}>
        {messageCount !== undefined && <Row label="Msgs" value={String(messageCount)} />}
        {duration && <Row label="Dur" value={duration} />}
        {totalCost > 0 && <Row label="Cost" value={`$${formatCost(totalCost)}`} />}
      </Box>
      {(watcherCount > 0 || schedulerCount > 0) && (
        <Box gap={2}>
          {watcherCount > 0 && <Row label="Watch" value={String(watcherCount)} />}
          {schedulerCount > 0 && <Row label="Sched" value={String(schedulerCount)} />}
        </Box>
      )}
      <TokenBar used={tokensUsed} total={tokensTotal} />

      {backgroundTasks.length > 0 && (
        <Box flexDirection="column">
          {backgroundTasks.slice(0, 3).map((task) => {
            const statusColor = task.status === 'running' ? COLORS.primary
              : task.status === 'completed' ? COLORS.success
              : task.status === 'failed' ? COLORS.error
              : COLORS.textDim;
            const statusIcon = task.status === 'running' ? '●'
              : task.status === 'completed' ? '✓'
              : task.status === 'failed' ? '✗'
              : task.status === 'cancelled' ? '⊘'
              : '○';
            return (
              <Box key={task.id}>
                <Text color={statusColor}>{statusIcon} </Text>
                <Text color={COLORS.textDim}>
                  {task.name.slice(0, 20)}
                </Text>
                {task.elapsed > 0 && (
                  <Text color={COLORS.textMuted}>
                    {' '}{formatDuration(task.elapsed)}
                  </Text>
                )}
              </Box>
            );
          })}
          {backgroundTasks.length > 3 && (
            <Text color={COLORS.textDim} dimColor>
              +{backgroundTasks.length - 3} more
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
};

const Row: FC<{ label: string; value: string }> = ({ label, value }) => (
  <Box>
    <Text color={COLORS.textDim}>{label}: </Text>
    <Text color={COLORS.text}>{value}</Text>
  </Box>
);

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatCost(cost: number): string {
  if (cost < 0.01) return `${(cost * 100).toFixed(2)}¢`;
  return cost.toFixed(4);
}
