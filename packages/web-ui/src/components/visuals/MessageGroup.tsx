import React from 'react';

const styles: Record<string, React.CSSProperties> = {
  group: {
    position: 'relative',
    marginBottom: '16px',
  },
  avatar: {
    width: '28px',
    height: '28px',
    borderRadius: 'var(--ax-radius-full)',
    background: 'var(--ax-accent)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: '12px',
    fontWeight: 700,
    marginRight: '10px',
    flexShrink: 0,
  },
  bubble: {
    maxWidth: 'min(900px, 68%)',
    borderRadius: 'var(--ax-radius-md)',
    border: '1px solid var(--ax-border)',
    background: 'var(--ax-surface)',
    padding: '12px 16px',
    fontSize: '14px',
    lineHeight: 1.6,
  },
  footer: {
    marginTop: '8px',
    paddingTop: '8px',
    borderTop: '1px solid var(--ax-border)',
    fontSize: '11px',
    color: 'var(--ax-textSecondary)',
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
  },
  footerItem: {
    whiteSpace: 'nowrap',
  },
};

interface MessageGroupFooter {
  tokensIn?: number;
  tokensOut?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
  contextPercent?: number;
  model?: string;
}

export const MessageGroup: React.FC<{
  role: 'assistant' | 'user';
  children: React.ReactNode;
  footer?: MessageGroupFooter;
}> = ({ role, children, footer }) => {
  const isAssistant = role === 'assistant';

  return (
    <div style={styles.group}>
      <div
        style={{
          display: 'flex',
          flexDirection: isAssistant ? 'row' : 'row-reverse',
          alignItems: 'flex-start',
        }}
      >
        <div style={styles.avatar}>
          {isAssistant ? 'AI' : 'U'}
        </div>
        <div style={styles.bubble}>
          {children}
          {footer ? (
            <div style={styles.footer}>
              {footer.tokensIn !== undefined && footer.tokensOut !== undefined ? (
                <span style={styles.footerItem}>
                  ↑{footer.tokensIn.toLocaleString()} ↓{footer.tokensOut.toLocaleString()}
                </span>
              ) : null}
              {footer.cacheRead !== undefined ? (
                <span style={styles.footerItem}>
                  💾 R:{footer.cacheRead.toLocaleString()}
                  {footer.cacheWrite ? ` W:${footer.cacheWrite.toLocaleString()}` : ''}
                </span>
              ) : null}
              {footer.cost !== undefined ? (
                <span style={styles.footerItem}>
                  ${footer.cost.toFixed(4)}
                </span>
              ) : null}
              {footer.contextPercent !== undefined ? (
                <span
                  style={{
                    ...styles.footerItem,
                    color:
                      footer.contextPercent >= 90
                        ? 'var(--ax-destructive)'
                        : footer.contextPercent >= 75
                          ? 'var(--ax-warn)'
                          : undefined,
                  }}
                >
                  {footer.contextPercent}%
                </span>
              ) : null}
              {footer.model ? (
                <span style={styles.footerItem}>{footer.model}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
