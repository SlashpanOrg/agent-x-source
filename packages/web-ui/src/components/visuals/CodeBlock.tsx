import React, { useState } from 'react';

const LANG_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  py: 'python', rs: 'rust', go: 'go', java: 'java',
  rb: 'ruby', php: 'php', sql: 'sql', sh: 'bash',
  bash: 'bash', zsh: 'bash', yaml: 'yaml', yml: 'yaml',
  json: 'json', md: 'markdown', html: 'html', css: 'css',
  dockerfile: 'dockerfile', tf: 'hcl',
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    borderRadius: 'var(--ax-radius-md)',
    border: '1px solid var(--ax-codeBorder)',
    background: 'var(--ax-codeBg)',
    overflow: 'hidden',
    margin: '8px 0',
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 12px',
    borderBottom: '1px solid var(--ax-codeBorder)',
    fontSize: '11px',
    color: 'var(--ax-textSecondary)',
    background: 'var(--ax-surface)',
  },
  langBadge: {
    textTransform: 'uppercase',
    fontWeight: 600,
    letterSpacing: '0.5px',
  },
  copyBtn: {
    background: 'none',
    border: '1px solid var(--ax-border)',
    borderRadius: 'var(--ax-radius-sm)',
    color: 'var(--ax-textSecondary)',
    cursor: 'pointer',
    fontSize: '10px',
    padding: '2px 8px',
  },
  code: {
    padding: '12px 16px',
    margin: 0,
    overflow: 'auto',
    fontSize: '13px',
    lineHeight: 1.6,
    color: 'var(--ax-codeText)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
};

export const CodeBlock: React.FC<{
  language?: string;
  content: string;
  isStreaming?: boolean;
  maxHeight?: number;
}> = ({ language, content, isStreaming, maxHeight }) => {
  const [copied, setCopied] = useState(false);
  const lang = language && LANG_MAP[language.toLowerCase()]
    ? LANG_MAP[language.toLowerCase()]
    : language || 'text';

  const copy = async () => {
    if (typeof navigator !== 'undefined') {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.langBadge}>{lang}</span>
        <button
          style={styles.copyBtn}
          onClick={copy}
          type="button"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre
        style={{
          ...styles.code,
          ...(maxHeight ? { maxHeight: `${maxHeight}px` } : {}),
          ...(isStreaming ? { opacity: 0.85 } : {}),
        }}
      >
        <code>{content}</code>
      </pre>
    </div>
  );
};
