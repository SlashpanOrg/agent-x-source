import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api';
import { useToast } from '../components/ToastProvider';

interface SubAgent {
  id: string;
  instruction: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  tools: string[];
  timeout: number;
  elapsed?: number;
  result?: string;
  error?: string;
}

export default function SubAgentDashboard() {
  const [agents, setAgents] = useState<SubAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      // Use the orchestrator plan endpoint to get sub-agent info
      // Since there's no dedicated sub-agent API, we'll show a placeholder
      const res = await apiGet<{ crews: Array<{ id: string; name: string }> }>('/api/crews');
      // Map crews as sub-agent proxies for now
      setAgents([]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load sub-agents';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function cancelAgent(id: string) {
    try {
      // Send cancel via WS since there's no dedicated cancel endpoint
      // We'll use the general cancel for now
      await apiPost('/api/chat/cancel');
      try { toast.push('Cancellation sent', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to cancel';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-label">Sub-Agents</div>
          <div className="topbar-value">{agents.length} active</div>
        </div>
        <div className="topbar-right">
          <button className="btn btn-sm btn-primary" onClick={load} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="page-scroll">
        <div style={{ padding: 24, maxWidth: 800, margin: '0 auto', width: '100%' }}>
          {loading && agents.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: '#555', fontSize: '0.85rem' }}>
              <div className="spinner" style={{ margin: '0 auto 16px' }} />
              Loading sub-agents...
            </div>
          )}

          {!loading && agents.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 48 }}>
              <div style={{ fontSize: '2rem', marginBottom: 12, opacity: 0.3 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ width: 48, height: 48 }}>
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              </div>
              <div style={{ fontSize: '0.9rem', color: '#888', marginBottom: 8 }}>No active sub-agents</div>
              <div style={{ fontSize: '0.75rem', color: '#555' }}>Sub-agents appear here when the main agent delegates tasks</div>
            </div>
          )}

          {agents.map((a) => (
            <div key={a.id} className="card mb-16">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <div style={{ fontSize: '0.85rem', color: '#ccc', fontWeight: 500, fontFamily: 'monospace' }}>{a.id}</div>
                    <span
                      className="prov-badge"
                      style={{
                        background: a.status === 'running' ? '#1a2a1a' : a.status === 'failed' ? '#2a1a1a' : '#1a1a1a',
                        color: a.status === 'running' ? '#8c8' : a.status === 'failed' ? '#c88' : '#888',
                      }}
                    >
                      {a.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#888', lineHeight: 1.5, marginBottom: 8 }}>{a.instruction}</div>
                  <div style={{ fontSize: '0.7rem', color: '#555' }}>
                    Tools: {a.tools.join(', ') || 'all'} · Timeout: {(a.timeout / 1000).toFixed(0)}s
                  </div>
                </div>
                {a.status === 'running' && (
                  <button className="btn btn-sm btn-ghost" style={{ color: '#c66' }} onClick={() => cancelAgent(a.id)}>
                    Cancel
                  </button>
                )}
              </div>
              {a.result && (
                <div style={{ marginTop: 8, padding: 8, background: '#0a0a0a', borderRadius: 4, fontSize: '0.75rem', color: '#888', maxHeight: 120, overflow: 'auto' }}>
                  {a.result}
                </div>
              )}
              {a.error && (
                <div style={{ marginTop: 8, padding: 8, background: '#1a0a0a', borderRadius: 4, fontSize: '0.75rem', color: '#c88' }}>
                  {a.error}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
