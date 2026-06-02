import React from 'react';

export const StreamingText: React.FC<{
  stableHtml: string;
  unstableText: string;
  isStreaming: boolean;
}> = ({ stableHtml, unstableText, isStreaming }) => {
  return (
    <div style={{ lineHeight: 1.6 }}>
      {stableHtml ? (
        <div
          style={{ marginBottom: '8px' }}
          dangerouslySetInnerHTML={{ __html: stableHtml }}
        />
      ) : null}
      <span>
        {unstableText}
        {isStreaming ? (
          <span
            className="ax-streaming-cursor"
            style={{
              display: 'inline',
              color: 'var(--ax-accent)',
              animation: 'ax-blink 1s step-end infinite',
            }}
          >
            ▍
          </span>
        ) : null}
      </span>
    </div>
  );
};

// Add blink keyframe to global styles at component init time
if (typeof document !== 'undefined' && !document.getElementById('ax-streaming-styles')) {
  const style = document.createElement('style');
  style.id = 'ax-streaming-styles';
  style.textContent = `
    @keyframes ax-blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }
    @keyframes ax-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    @keyframes ax-shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    .ax-tool-pending { color: var(--ax-toolPending); }
    .ax-tool-running { color: var(--ax-toolRunning); animation: ax-pulse 1.5s ease-in-out infinite; }
    .ax-tool-ok { color: var(--ax-toolCompleted); }
    .ax-tool-error { color: var(--ax-toolError); }
    .ax-tool-denied { color: var(--ax-toolDenied); text-decoration: line-through; }
    .ax-streaming-cursor { animation: ax-blink 1s step-end infinite; }
  `;
  document.head.appendChild(style);
}
