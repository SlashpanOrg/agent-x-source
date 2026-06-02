import React, { useState, useEffect } from 'react';

export interface ToolCardProps {
  id: string;
  name: string;
  icon: string;
  label: string;
  detail?: string;
  status: string;
  input?: string;
  output?: string;
  error?: string;
  durationMs?: number;
  isExpanded: boolean;
}

const STATUS_ICONS: Record<string, string> = {
  pending: '○',
  running: '◌',
  completed: '✓',
  error: '✕',
  denied: '—',
};

const STATUS_CLASSES: Record<string, string> = {
  pending: 'ax-tool-pending',
  running: 'ax-tool-running',
  completed: 'ax-tool-ok',
  error: 'ax-tool-error',
  denied: 'ax-tool-denied',
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    borderRadius: 'var(--ax-radius-md)',
    border: '1px solid var(--ax-border)',
    background: 'var(--ax-surface)',
    padding: '10px 14px',
    marginBottom: '8px',
    fontFamily: 'monospace',
    fontSize: '13px',
    transition: 'all var(--ax-duration-normal) var(--ax-ease-out)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    userSelect: 'none',
  },
  icon: { fontSize: '14px' },
  label: { fontWeight: 600 },
  detail: { fontSize: '12px' },
  duration: { fontSize: '11px', marginLeft: 'auto' },
  body: {
    marginTop: '8px',
    padding: '10px',
    borderRadius: 'var(--ax-radius-sm)',
    background: 'var(--ax-codeBg)',
    border: '1px solid var(--ax-codeBorder)',
    fontSize: '12px',
    maxHeight: '300px',
    overflow: 'auto',
  },
  errorText: { color: 'var(--ax-destructive)', fontSize: '12px', marginTop: '4px' },
};

export const ToolCard: React.FC<{ card: ToolCardProps; onToggle?: (id: string) => void }> = ({
  card,
  onToggle,
}) => {
  const [expanded, setExpanded] = useState(card.isExpanded);

  useEffect(() => {
    setExpanded(card.isExpanded);
  }, [card.isExpanded]);

  const duration = card.durationMs ? `${card.durationMs}ms` : '';

  return (
    <div style={styles.card}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
      <div
        style={styles.header}
        onClick={() => {
          const next = !expanded;
          setExpanded(next);
          onToggle?.(card.id);
        }}
        role="button"
        tabIndex={0}
      >
        <span className={STATUS_CLASSES[card.status]} style={styles.icon}>
          {STATUS_ICONS[card.status]}
        </span>
        <span style={styles.icon}>{card.icon}</span>
        <span style={styles.label}>{card.label}</span>
        {card.detail ? <span style={styles.detail}>{card.detail}</span> : null}
        <span style={styles.duration}>{duration}</span>
      </div>

      {expanded && card.input ? (
        <div style={styles.body}>
          <strong>Input:</strong>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {card.input.slice(0, 1000)}
          </pre>
        </div>
      ) : null}

      {expanded && card.output ? (
        <div style={styles.body}>
          <strong>Output:</strong>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {card.output.slice(0, 2000)}
          </pre>
        </div>
      ) : null}

      {card.error ? <div style={styles.errorText}>{card.error}</div> : null}
    </div>
  );
};
