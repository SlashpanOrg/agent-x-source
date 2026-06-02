import React, { useState, useEffect } from 'react';

export interface TodoItem {
  id: number;
  title: string;
  status: 'not-started' | 'in-progress' | 'completed';
}

const STATUS_ICONS: Record<string, string> = {
  'not-started': '☐',
  'in-progress': '⟳',
  'completed': '☑',
};

const STATUS_COLORS: Record<string, string> = {
  'not-started': '#8b949e',
  'in-progress': '#58a6ff',
  'completed': '#3fb950',
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    border: '1px solid var(--ax-border)',
    borderRadius: 'var(--ax-radius-md)',
    background: 'var(--ax-surface)',
    padding: '12px 14px',
    margin: '8px 0',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    fontWeight: 700,
    marginBottom: '8px',
    color: 'var(--ax-textPrimary)',
    cursor: 'pointer',
    userSelect: 'none',
  },
  list: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  item: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    padding: '3px 0',
    fontSize: '13px',
    lineHeight: 1.5,
    color: 'var(--ax-textPrimary)',
  },
  itemCompleted: {
    textDecoration: 'line-through',
    color: 'var(--ax-textMuted)',
    fontSize: '13px',
    lineHeight: 1.5,
  },
  archiveMsg: {
    marginTop: '8px',
    padding: '6px 10px',
    borderRadius: 'var(--ax-radius-sm)',
    background: 'var(--ax-codeBg)',
    fontSize: '11px',
    color: 'var(--ax-textSecondary)',
    fontStyle: 'italic',
  },
};

export const TodoList: React.FC<{
  items: TodoItem[];
  isLive?: boolean;
  onToggle?: (id: number) => void;
}> = ({ items, isLive = false, onToggle }) => {
  const [expanded, setExpanded] = useState(true);
  const [archived, setArchived] = useState(false);

  // Archive when live mode turns off (turn complete)
  useEffect(() => {
    if (!isLive && items.length > 0 && !archived) {
      setArchived(true);
      setExpanded(false);
    }
    if (isLive) {
      setArchived(false);
      setExpanded(true);
    }
  }, [isLive, items, archived]);

  const completed = items.filter((t) => t.status === 'completed').length;
  const total = items.length;
  const header = isLive ? `📋 Tasks (${completed}/${total})` : (archived ? `📋 Tasks (${completed}/${total}) — archived` : `📋 Tasks (${completed}/${total})`);

  if (total === 0) return null;

  return (
    <div style={styles.container}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
      <div
        style={styles.header}
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span>{header}</span>
      </div>

      {expanded ? (
        <ul style={styles.list}>
          {items.map((item) => (
            <li
              key={item.id}
              style={
                item.status === 'completed' ? styles.itemCompleted : styles.item
              }
            >
              <span
                style={{
                  color: STATUS_COLORS[item.status] || '#8b949e',
                  cursor: onToggle ? 'pointer' : 'default',
                  flexShrink: 0,
                }}
                onClick={() => onToggle?.(item.id)}
              >
                {STATUS_ICONS[item.status] || '☐'}
              </span>
              <span>{item.title}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {archived && !expanded ? (
        <div style={styles.archiveMsg}>
          ✓ {completed}/{total} tasks completed
        </div>
      ) : null}
    </div>
  );
};
