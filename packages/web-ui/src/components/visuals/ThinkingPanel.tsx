import React, { useState } from 'react';

const styles: Record<string, React.CSSProperties> = {
  container: {
    margin: '12px 0',
    borderRadius: 'var(--ax-radius-md)',
    border: '1px dashed var(--ax-thinkingBorder)',
    background: 'var(--ax-thinkingBg)',
    padding: '10px 14px',
    transition: 'all var(--ax-duration-normal) var(--ax-ease-out)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    cursor: 'pointer',
    userSelect: 'none',
    fontSize: '12px',
  },
  content: {
    marginTop: '8px',
    fontSize: '13px',
    opacity: 0.7,
    maxHeight: '200px',
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
  },
};

export const ThinkingPanel: React.FC<{
  isActive: boolean;
  content: string;
  title?: string;
  isExpanded?: boolean;
}> = ({ isActive, content, title, isExpanded: initialExpanded = true }) => {
  const [expanded, setExpanded] = useState(initialExpanded);

  if (!content && !isActive) return null;

  const display = content || 'Thinking...';
  const label = title || 'Thinking';

  return (
    <div style={styles.container}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
      <div
        style={styles.header}
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
      >
        <span style={{ color: 'var(--ax-accent)' }}>
          {isActive ? '⟳' : expanded ? '▾' : '▸'}
        </span>
        <span style={{ color: 'var(--ax-thinkingText)' }}>
          {label} · {display.length} chars
        </span>
      </div>
      {expanded ? (
        <div style={styles.content}>
          {display}
        </div>
      ) : null}
    </div>
  );
};
