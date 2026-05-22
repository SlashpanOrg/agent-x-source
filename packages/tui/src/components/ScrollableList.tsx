import React, { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { COLORS } from '../theme/colors.js';

interface ScrollableListProps<T> {
  items: T[];
  renderItem: (item: T, isSelected: boolean) => React.ReactNode;
  onSelect: (item: T) => void;
  onCancel?: () => void;
  maxVisible?: number;
  label?: string;
}

export function ScrollableList<T>({
  items,
  renderItem,
  onSelect,
  onCancel,
  maxVisible: maxVisibleProp,
  label,
}: ScrollableListProps<T>): React.ReactElement {
  const { stdout } = useStdout();
  const terminalRows = stdout?.rows ?? 24;
  // Reserve rows for label, indicators, help text, padding
  const availableRows = Math.max(4, terminalRows - 8);
  const maxVisible = Math.min(maxVisibleProp ?? 15, availableRows, items.length);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setSelectedIndex((i) => {
        const next = i > 0 ? i - 1 : items.length - 1;
        // Scroll up if cursor goes above visible area
        if (next < scrollOffset) {
          setScrollOffset(next);
        }
        // Wrap: if we jumped to end, scroll to show it
        if (next === items.length - 1) {
          setScrollOffset(Math.max(0, items.length - maxVisible));
        }
        return next;
      });
    } else if (key.downArrow || input === 'j') {
      setSelectedIndex((i) => {
        const next = i < items.length - 1 ? i + 1 : 0;
        // Scroll down if cursor goes below visible area
        if (next >= scrollOffset + maxVisible) {
          setScrollOffset(next - maxVisible + 1);
        }
        // Wrap: if we jumped to start, reset scroll
        if (next === 0) {
          setScrollOffset(0);
        }
        return next;
      });
    } else if (key.return) {
      const item = items[selectedIndex];
      if (item !== undefined) {
        onSelect(item);
      }
    } else if (key.escape && onCancel) {
      onCancel();
    }
  });

  const visibleItems = items.slice(scrollOffset, scrollOffset + maxVisible);
  const page = Math.floor(scrollOffset / maxVisible) + 1;
  const totalPages = Math.ceil(items.length / maxVisible);

  return (
    <Box flexDirection="column">
      {label && (
        <Box marginBottom={1}>
          <Text color={COLORS.primary} bold>{label}</Text>
          <Text color={COLORS.textDim}> ({items.length} items{totalPages > 1 ? ` • page ${page}/${totalPages}` : ''})</Text>
        </Box>
      )}
      {scrollOffset > 0 && (
        <Text color={COLORS.textDim}>  ↑ {scrollOffset} more above</Text>
      )}
      {visibleItems.map((item, i) => {
        const actualIndex = scrollOffset + i;
        const isSelected = actualIndex === selectedIndex;
        return (
          <Box key={actualIndex}>
            <Text color={isSelected ? COLORS.primary : COLORS.textDim}>
              {isSelected ? '❯ ' : '  '}
            </Text>
            {renderItem(item, isSelected)}
          </Box>
        );
      })}
      {scrollOffset + maxVisible < items.length && (
        <Text color={COLORS.textDim}>  ↓ {items.length - scrollOffset - maxVisible} more below</Text>
      )}
      <Box marginTop={1}>
        <Text color={COLORS.textDim} dimColor>
          ↑↓/jk navigate • Enter select{onCancel ? ' • Esc cancel' : ''}
        </Text>
      </Box>
    </Box>
  );
}
