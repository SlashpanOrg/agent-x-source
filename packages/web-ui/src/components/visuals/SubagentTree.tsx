import React from 'react';

interface SubAgent {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error';
  elapsed: number;
  tools?: Array<{ name: string; status: string; elapsed: number }>;
}

const HEATMAP_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f85149'];

const styles: Record<string, React.CSSProperties> = {
  container: {
    border: '1px solid var(--ax-border)',
    borderRadius: 'var(--ax-radius-md)',
    padding: '12px 14px',
    margin: '8px 0',
    background: 'var(--ax-surface)',
    fontFamily: 'monospace',
    fontSize: '12px',
  },
  header: {
    fontWeight: 700,
    marginBottom: '8px',
    color: 'var(--ax-textSecondary)',
  },
  agent: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '2px 0',
  },
  stem: {
    fontWeight: 700,
    flexShrink: 0,
  },
  status: {
    flexShrink: 0,
  },
  name: {
    color: 'var(--ax-textPrimary)',
  },
  elapsed: {
    color: 'var(--ax-textMuted)',
    marginLeft: 'auto',
    fontSize: '11px',
  },
  toolCount: {
    color: 'var(--ax-textSecondary)',
    fontSize: '11px',
  },
  tool: {
    padding: '1px 0',
    paddingLeft: '24px',
    display: 'flex',
    gap: '6px',
    fontSize: '11px',
    color: 'var(--ax-textSecondary)',
  },
  footer: {
    marginTop: '6px',
    paddingTop: '6px',
    borderTop: '1px solid var(--ax-border)',
    color: 'var(--ax-textMuted)',
    fontSize: '11px',
  },
};

export const SubagentTree: React.FC<{
  agents: SubAgent[];
}> = ({ agents }) => {
  if (agents.length === 0) return null;

  const maxElapsed = Math.max(...agents.map((a) => a.elapsed), 1);
  const totalTools = agents.reduce((s, a) => s + (a.tools?.length ?? 0), 0);

  const getHeatmapColor = (elapsed: number): string => {
    const ratio = elapsed / maxElapsed;
    if (ratio < 0.33) return HEATMAP_COLORS[0]!;
    if (ratio < 0.66) return HEATMAP_COLORS[1]!;
    if (ratio < 0.9) return HEATMAP_COLORS[2]!;
    return HEATMAP_COLORS[3]!;
  };

  const statusIcons: Record<string, string> = {
    running: '⟳',
    done: '✓',
    error: '✗',
  };

  const statusColors: Record<string, string> = {
    running: 'var(--ax-toolRunning)',
    done: 'var(--ax-toolCompleted)',
    error: 'var(--ax-toolError)',
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        ─── Sub-agents ({agents.length}) ───
      </div>

      {agents.map((agent, i) => {
        const isLast = i === agents.length - 1;
        const branch = isLast ? '└─' : '├─';
        const stemColor = getHeatmapColor(agent.elapsed);

        return (
          <div key={agent.id}>
            <div style={styles.agent}>
              <span style={{ ...styles.stem, color: stemColor }}>{branch}</span>
              <span style={{ ...styles.status, color: statusColors[agent.status] }}>
                {statusIcons[agent.status]}
              </span>
              <span style={styles.name}>{agent.name}</span>
              <span style={styles.toolCount}>
                {agent.tools?.length ? `${agent.tools.length} tools` : ''}
              </span>
              <span style={styles.elapsed}>{agent.elapsed}ms</span>
            </div>

            {agent.tools?.map((tool, ti) => {
              const toolBranch = ti === (agent.tools?.length ?? 1) - 1 ? '└─' : '├─';
              const prefix = isLast ? '   ' : '│  ';
              return (
                <div key={ti} style={styles.tool}>
                  <span style={{ color: 'var(--ax-textMuted)' }}>
                    {prefix}{toolBranch}
                  </span>
                  <span style={{ color: tool.status === 'done' ? 'var(--ax-toolCompleted)' : 'var(--ax-textMuted)' }}>
                    {tool.status === 'done' ? '✓' : '~'}
                  </span>
                  <span>{tool.name}</span>
                  <span style={{ color: 'var(--ax-textMuted)' }}>({tool.elapsed}ms)</span>
                </div>
              );
            })}
          </div>
        );
      })}

      <div style={styles.footer}>
        ─── {totalTools} tools · max {maxElapsed}ms ───
      </div>
    </div>
  );
};
