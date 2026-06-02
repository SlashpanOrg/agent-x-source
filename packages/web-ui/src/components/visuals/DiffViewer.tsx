import React, { useState } from 'react';

const styles: Record<string, React.CSSProperties> = {
  container: {
    borderRadius: 'var(--ax-radius-md)',
    border: '1px solid var(--ax-codeBorder)',
    overflow: 'hidden',
    margin: '8px 0',
    fontFamily: 'monospace',
    fontSize: '12px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '4px 12px',
    borderBottom: '1px solid var(--ax-codeBorder)',
    background: 'var(--ax-surface)',
    fontSize: '11px',
    color: 'var(--ax-textSecondary)',
  },
  code: {
    padding: '8px 0',
    margin: 0,
    overflow: 'auto',
    maxHeight: '500px',
    lineHeight: 1.5,
  },
  line: {
    display: 'flex',
    padding: '0 12px',
  },
  lineNum: {
    width: '40px',
    textAlign: 'right',
    color: 'var(--ax-diffLineNumber)',
    marginRight: '12px',
    userSelect: 'none',
    flexShrink: 0,
  },
  addedBg: {
    background: 'var(--ax-diffAddedBg)',
    borderLeft: '3px solid var(--ax-diffAdded)',
  },
  removedBg: {
    background: 'var(--ax-diffRemovedBg)',
    borderLeft: '3px solid var(--ax-diffRemoved)',
  },
  addedSign: { color: 'var(--ax-diffAdded)', fontWeight: 700 },
  removedSign: { color: 'var(--ax-diffRemoved)', fontWeight: 700 },
};

export const DiffViewer: React.FC<{
  diff: string;
  filetype?: string;
}> = ({ diff, filetype }) => {
  const [view, setView] = useState<'unified' | 'split'>('unified');
  const lines = diff.split('\n');

  const renderLine = (line: string, idx: number) => {
    const isAdded = line.startsWith('+') && !line.startsWith('+++');
    const isRemoved = line.startsWith('-') && !line.startsWith('---');
    const isHeader = line.startsWith('@@');
    const lineNum = idx + 1;

    return (
      <div
        key={idx}
        style={{
          ...styles.line,
          ...(isAdded ? styles.addedBg : {}),
          ...(isRemoved ? styles.removedBg : {}),
        }}
      >
        <span style={styles.lineNum}>{lineNum}</span>
        <span
          style={{
            color: isAdded
              ? 'var(--ax-diffAdded)'
              : isRemoved
                ? 'var(--ax-diffRemoved)'
                : isHeader
                  ? 'var(--ax-accent)'
                  : 'var(--ax-textPrimary)',
          }}
        >
          {line}
        </span>
      </div>
    );
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span>{filetype || 'Diff'}</span>
        <span
          onClick={() => setView(view === 'unified' ? 'split' : 'unified')}
          style={{ cursor: 'pointer', userSelect: 'none' }}
          role="button"
          tabIndex={0}
        >
          [{view} view]
        </span>
      </div>
      <pre style={styles.code}>{lines.map(renderLine)}</pre>
    </div>
  );
};
