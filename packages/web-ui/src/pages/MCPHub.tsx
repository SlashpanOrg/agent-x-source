import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiDelete } from '../api';
import { useToast } from '../components/ToastProvider';

interface MCPServer {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
  status: 'running' | 'stopped' | 'error';
  toolCount: number;
  pid?: number;
  error?: string;
}

export default function MCPHub() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const [newArgs, setNewArgs] = useState('');
  const [newEnv, setNewEnv] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      const res = await apiGet<{ servers: MCPServer[] }>('/api/mcp/servers');
      setServers(res.servers || []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load MCP servers';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addServer() {
    if (!newName.trim() || !newCommand.trim()) return;
    setSaving(true);
    try {
      const args = newArgs.trim() ? newArgs.trim().split(/\s+/) : [];
      const env: Record<string, string> = {};
      if (newEnv.trim()) {
        for (const line of newEnv.trim().split('\n')) {
          const [k, ...v] = line.split('=');
          if (k && v.length > 0) env[k.trim()] = v.join('=').trim();
        }
      }
      await apiPost('/api/mcp/servers', {
        name: newName.trim(),
        command: newCommand.trim(),
        args,
        env: Object.keys(env).length > 0 ? env : undefined,
      });
      setShowAdd(false);
      setNewName('');
      setNewCommand('');
      setNewArgs('');
      setNewEnv('');
      await load();
      try { toast.push('MCP server added', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to add MCP server';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
    setSaving(false);
  }

  async function removeServer(name: string) {
    try {
      await apiDelete(`/api/mcp/servers/${name}`);
      await load();
      try { toast.push('MCP server removed', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to remove MCP server';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  async function restartServer(name: string) {
    try {
      await apiPost(`/api/mcp/servers/${name}/restart`);
      await load();
      try { toast.push('MCP server restarted', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to restart MCP server';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-label">MCP Hub</div>
          <div className="topbar-value">{servers.length} server{servers.length !== 1 ? 's' : ''}</div>
        </div>
        <div className="topbar-right">
          <button className="btn btn-sm btn-primary" onClick={() => setShowAdd(true)}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ width: 12, height: 12, marginRight: 4, verticalAlign: 'middle' }}>
              <path d="M8 3v10M3 8h10"/>
            </svg>
            Add Server
          </button>
        </div>
      </div>

      <div className="page-scroll">
        <div style={{ padding: 24, maxWidth: 800, margin: '0 auto', width: '100%' }}>
          {loading && servers.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: '#555', fontSize: '0.85rem' }}>
              <div className="spinner" style={{ margin: '0 auto 16px' }} />
              Loading MCP servers...
            </div>
          )}

          {!loading && servers.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 48 }}>
              <div style={{ fontSize: '2rem', marginBottom: 12, opacity: 0.3 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ width: 48, height: 48 }}>
                  <rect x="2" y="2" width="20" height="8" rx="2"/>
                  <rect x="2" y="14" width="20" height="8" rx="2"/>
                  <path d="M6 6h.01M6 18h.01"/>
                </svg>
              </div>
              <div style={{ fontSize: '0.9rem', color: '#888', marginBottom: 8 }}>No MCP servers configured</div>
              <div style={{ fontSize: '0.75rem', color: '#555' }}>Add MCP servers to extend your agent with 3rd-party tools</div>
            </div>
          )}

          {servers.map((s) => (
            <div key={s.name} className="card mb-16">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <div style={{ fontSize: '0.9rem', color: '#ccc', fontWeight: 500 }}>{s.name}</div>
                    <span
                      className="prov-badge"
                      style={{
                        background: s.status === 'running' ? '#1a2a1a' : s.status === 'error' ? '#2a1a1a' : '#1a1a1a',
                        color: s.status === 'running' ? '#8c8' : s.status === 'error' ? '#c88' : '#888',
                      }}
                    >
                      {s.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#555', fontFamily: 'monospace' }}>{s.command} {s.args?.join(' ')}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => restartServer(s.name)} title="Restart">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ width: 12, height: 12 }}>
                      <path d="M2 8a6 6 0 0 1 6-6 6 6 0 0 1 5.2 3"/><path d="M14 2v4h-4"/><path d="M14 8a6 6 0 0 1-6 6 6 6 0 0 1-5.2-3"/><path d="M2 14v-4h4"/>
                    </svg>
                  </button>
                  <button className="btn btn-sm btn-ghost" style={{ color: '#c66' }} onClick={() => removeServer(s.name)} title="Remove">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ width: 12, height: 12 }}>
                      <path d="M2 3.5h12M4.5 3.5V2a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v1.5M6 6v6M10 6v6M3 3.5l.7 8.4a1 1 0 0 0 1 .9h6.6a1 1 0 0 0 1-.9l.7-8.4"/>
                    </svg>
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: '0.75rem', color: '#666' }}>
                <span>Tools: <strong style={{ color: '#aaa' }}>{s.toolCount}</strong></span>
                {s.pid && <span>PID: <strong style={{ color: '#aaa' }}>{s.pid}</strong></span>}
              </div>
              {s.error && (
                <div style={{ marginTop: 8, padding: 8, background: '#1a0a0a', borderRadius: 4, fontSize: '0.75rem', color: '#c88' }}>
                  {s.error}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Add server modal */}
      {showAdd && (
        <div className="overlay" onClick={() => setShowAdd(false)}>
          <div className="overlay-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <button className="overlay-close" onClick={() => setShowAdd(false)}>✕</button>
            <div className="overlay-title">Add MCP Server</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="field">
                <label className="label">Name</label>
                <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="filesystem" />
              </div>
              <div className="field">
                <label className="label">Command</label>
                <input className="input" value={newCommand} onChange={(e) => setNewCommand(e.target.value)} placeholder="npx -y @modelcontextprotocol/server-filesystem /path" />
              </div>
              <div className="field">
                <label className="label">Arguments (space-separated, optional)</label>
                <input className="input" value={newArgs} onChange={(e) => setNewArgs(e.target.value)} placeholder="--readonly /home/user/docs" />
              </div>
              <div className="field">
                <label className="label">Environment Variables (KEY=VAL per line, optional)</label>
                <textarea
                  className="input"
                  value={newEnv}
                  onChange={(e) => setNewEnv(e.target.value)}
                  placeholder="API_KEY=sk-...\nDEBUG=true"
                  rows={3}
                  style={{ resize: 'vertical', minHeight: 60 }}
                />
              </div>
              <div className="wizard-actions" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={addServer} disabled={saving || !newName.trim() || !newCommand.trim()}>
                  {saving ? 'Adding...' : 'Add Server'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
