import React from 'react';
import { Box, Text } from 'ink';

interface SubAgent {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error';
  elapsed: number;
  tools?: Array<{ name: string; status: string; elapsed: number }>;
}

const HEATMAP_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f85149'];

export const SubagentTree: React.FC<{
  agents: SubAgent[];
}> = ({ agents }) => {
  if (agents.length === 0) return null;

  const maxElapsed = Math.max(...agents.map((a) => a.elapsed), 1);

  const getHeatmapColor = (elapsed: number): string => {
    const ratio = elapsed / maxElapsed;
    if (ratio < 0.33) return HEATMAP_COLORS[0]!;
    if (ratio < 0.66) return HEATMAP_COLORS[1]!;
    if (ratio < 0.9) return HEATMAP_COLORS[2]!;
    return HEATMAP_COLORS[3]!;
  };

  const statusIcons: Record<string, string> = {
    running: '⟳',
    done: '✓',
    error: '✗',
  };

  return (
    <Box flexDirection="column" marginY={1}>
      <Text color="#8b949e" bold>
        ─── Sub-agents ({agents.length}) ───
      </Text>
      {agents.map((agent, i) => {
        const isLast = i === agents.length - 1;
        const branch = isLast ? '└─' : '├─';
        const stemColor = getHeatmapColor(agent.elapsed);
        const icon = statusIcons[agent.status] || '~';
        const statusColor = agent.status === 'error' ? '#f85149' : agent.status === 'done' ? '#3fb950' : '#58a6ff';

        return (
          <Box key={agent.id} flexDirection="column">
            <Box>
              <Text color={stemColor}>{branch} </Text>
              <Text color={statusColor}>{icon} </Text>
              <Text>{agent.name}</Text>
              <Text color="#484f58"> · {agent.elapsed}ms</Text>
              {agent.tools ? (
                <Text color="#8b949e"> · {agent.tools.length} tools</Text>
              ) : null}
            </Box>
            {agent.tools?.map((tool, ti) => {
              const toolBranch = ti === (agent.tools?.length ?? 1) - 1 ? '└─' : '├─';
              const prefix = isLast ? '   ' : '│  ';
              return (
                <Box key={`${agent.id}-${ti}`}>
                  <Text color="#484f58">{prefix}{toolBranch} </Text>
                  <Text color={tool.status === 'done' ? '#3fb950' : '#8b949e'}>
                    {tool.status === 'done' ? '✓' : '~'}
                  </Text>
                  <Text> {tool.name}</Text>
                  <Text color="#484f58"> ({tool.elapsed}ms)</Text>
                </Box>
              );
            })}
          </Box>
        );
      })}
      <Box>
        <Text color="#8b949e" dimColor>
          ─── {agents.reduce((s, a) => s + (a.tools?.length ?? 0), 0)} tools · max {maxElapsed}ms ───
        </Text>
      </Box>
    </Box>
  );
};
