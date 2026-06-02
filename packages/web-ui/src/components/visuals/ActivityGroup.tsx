import React, { useState } from 'react';

const styles: Record<string, React.CSSProperties> = {
  container: {
    borderRadius: 'var(--ax-radius-sm)',
    border: '1px solid var(--ax-border)',
    background: 'var(--ax-surface)',
    padding: '8px 12px',
    margin: '6px 0',
    fontSize: '12px',
    color: 'var(--ax-textSecondary)',
  },
  toggle: {
    cursor: 'pointer',
    userSelect: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontWeight: 600,
  },
  tools: {
    marginTop: '6px',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
  },
  tool: {
    padding: '2px 8px',
    borderRadius: 'var(--ax-radius-sm)',
    background: 'var(--ax-codeBg)',
    border: '1px solid var(--ax-codeBorder)',
    fontSize: '11px',
    fontFamily: 'monospace',
  },
};

export const ActivityGroup: React.FC<{
  toolNames: string[];
  defaultExpanded?: boolean;
}> = ({ toolNames, defaultExpanded = false }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (toolNames.length === 0) return null;

  return (
    <div style={styles.container}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
      <div
        style={styles.toggle}
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span>⚡ Activity: {toolNames.length} tools</span>
      </div>
      {expanded ? (
        <div style={styles.tools}>
          {toolNames.map((name, i) => (
            <span key={i} style={styles.tool}>
              {name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
};
