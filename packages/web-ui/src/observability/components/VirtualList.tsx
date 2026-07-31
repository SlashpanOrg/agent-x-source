/** Thin wrapper for virtualized lists (§11.11) — uses simple windowing. */
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { Box } from '@mui/material';

export function VirtualList<T>({
  items,
  itemHeight,
  renderItem,
  height = 500,
  overscan = 10,
}: {
  items: T[];
  itemHeight: number;
  renderItem: (item: T, index: number) => ReactNode;
  height?: number;
  overscan?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(items.length, Math.ceil((scrollTop + height) / itemHeight) + overscan);
  const visibleItems = items.slice(startIndex, endIndex);

  return (
    <Box ref={ref} sx={{ height, overflow: 'auto', position: 'relative' }}>
      <Box sx={{ height: items.length * itemHeight, position: 'relative' }}>
        <Box sx={{ position: 'absolute', top: startIndex * itemHeight, left: 0, right: 0 }}>
          {visibleItems.map((item, i) => renderItem(item, startIndex + i))}
        </Box>
      </Box>
    </Box>
  );
}
