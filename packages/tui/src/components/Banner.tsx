import { type FC } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';
import { VERSION, APP_NAME, TAGLINE } from '@agentx/shared';
import type { OrganizationConfig } from '@agentx/shared';

interface BannerProps {
  provider?: string;
  model?: string;
  organization?: OrganizationConfig | null;
  crewName?: string;
  profileLabel?: string | null;
  scopePath?: string;
  sessionName?: string;
  toolCount?: number;
  planMode?: boolean;
  totalCost?: number;
  maxBudget?: number;
  ragIndexStats?: { indexedCount: number; indexedAt: number | null };
  currentTaskType?: string | null;
  isIndexing?: boolean;
  indexingProgress?: { indexed: number; total: number } | null;
}

export const Banner: FC<BannerProps> = ({ provider, model, organization, crewName, profileLabel, scopePath, sessionName, toolCount, planMode, totalCost, maxBudget, ragIndexStats, currentTaskType, isIndexing, indexingProgress }) => {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={COLORS.border}
      paddingX={1}
    >
      {/* Header row */}
      <Box>
        <Text color={COLORS.primary}>✦ </Text>
        <Text color={COLORS.primary} bold>
          {APP_NAME}
        </Text>
        <Text color={COLORS.textDim}> v{VERSION}</Text>
        <Text color={COLORS.accent}> — {TAGLINE}</Text>
        {organization?.name && (
          <Text color={COLORS.textDim}> • {organization.name}</Text>
        )}
      </Box>

      {/* Provider / Model row */}
      {provider && model && (
        <Box>
          <Text color={COLORS.textDim}>⊹ </Text>
          <Text color={COLORS.info}>{provider}</Text>
          <Text color={COLORS.textDim}> / </Text>
          <Text color={COLORS.text}>{model}</Text>
          {currentTaskType && (
            <Text color={COLORS.accent}> [{currentTaskType}]</Text>
          )}
          {isIndexing && indexingProgress && (
            <Text color={COLORS.warning}> indexing {indexingProgress.indexed}/{indexingProgress.total}</Text>
          )}
          {profileLabel && (
            <Text color={COLORS.textDim}> {' '}• [{profileLabel}]</Text>
          )}
        </Box>
      )}

      {!provider && (
        <Box>
          <Text color={COLORS.primaryDim}>⊹ Booting systems...</Text>
        </Box>
      )}

      {/* Scope path */}
      {scopePath && (
        <Box>
          <Text color={COLORS.textDim}>📁 </Text>
          <Text color={COLORS.text} wrap="truncate-start">{scopePath}</Text>
        </Box>
      )}

      {/* Plan mode indicator */}
      {planMode && (
        <Box>
          <Text color={COLORS.warning}>⚠ PLAN MODE ACTIVE</Text>
        </Box>
      )}

      {/* RAG index stats */}
      {ragIndexStats && ragIndexStats.indexedCount > 0 && (
        <Box>
          <Text color={COLORS.textDim}>📚 </Text>
          <Text color={COLORS.text}>{ragIndexStats.indexedCount} files indexed</Text>
          {ragIndexStats.indexedAt && (
            <Text color={COLORS.textMuted}>
              {' '}({new Date(ragIndexStats.indexedAt).toLocaleTimeString()})
            </Text>
          )}
        </Box>
      )}

      {/* Session name, tool count, cost, and budget on the same line */}
      <Box gap={2}>
        {sessionName && (
          <Box>
            <Text color={COLORS.textDim}>💬 </Text>
            <Text color={COLORS.text}>{sessionName}</Text>
          </Box>
        )}
        {toolCount !== undefined && (
          <Box>
            <Text color={COLORS.textDim}>🔧 </Text>
            <Text color={COLORS.text}>{toolCount} tools</Text>
          </Box>
        )}
        {totalCost !== undefined && totalCost > 0 && (
          <Box>
            <Text color={COLORS.textDim}>💰 </Text>
            <Text color={COLORS.text}>{totalCost < 0.01 ? `$${(totalCost * 100).toFixed(2)}¢` : `$${totalCost.toFixed(4)}`}</Text>
          </Box>
        )}
        {maxBudget !== undefined && maxBudget > 0 && (
          <Box>
            <Text color={COLORS.warning}>⛔ </Text>
            <Text color={COLORS.warning}>${maxBudget.toFixed(2)}</Text>
          </Box>
        )}
      </Box>

      {/* Crew name as the identifier line */}
      {crewName && (
        <>
          <Box marginTop={0}>
            <Text color={COLORS.border}>{'─'.repeat(40)}</Text>
          </Box>
          <Box>
            <Text color={COLORS.accent}>⊹ {crewName}</Text>
          </Box>
        </>
      )}
    </Box>
  );
};
