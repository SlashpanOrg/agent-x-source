import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { TodoItem } from '@agentx/shared';

const STATUS_ICONS: Record<string, string> = {
  'not-started': '☐',
  'in-progress': '⟳',
  'completed': '☑',
};

export const TodoList: React.FC<{ items: TodoItem[]; isLive?: boolean }> = ({ items, isLive = false }) => {
  const [archived, setArchived] = useState(false);

  useEffect(() => {
    if (!isLive && items.length > 0) {
      setArchived(true);
    }
    if (isLive) {
      setArchived(false);
    }
  }, [isLive, items]);

  if (items.length === 0) return null;

  const completed = items.filter((t) => t.status === 'completed').length;

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text bold>
          📋 Tasks ({completed}/{items.length})
          {isLive ? ' ⟳' : archived ? ' (archived)' : ''}
        </Text>
      </Box>
      {items.map((item) => (
        <Box key={item.id} marginLeft={2}>
          <Text
            color={
              item.status === 'completed'
                ? '#3fb950'
                : item.status === 'in-progress'
                  ? '#58a6ff'
                  : '#8b949e'
            }
          >
            {STATUS_ICONS[item.status] || '☐'} {item.title}
          </Text>
        </Box>
      ))}
    </Box>
  );
};
