import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../api';
import { useToast } from '../components/ToastProvider';

interface PluginHubEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  tags: string[];
  isBuiltin: boolean;
  config?: Record<string, unknown>;
}

interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  enabled: boolean;
  config: Record<string, unknown>;
  installedAt: string;
  isBuiltin: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  database: 'Database',
  messaging: 'Messaging & Notifications',
  storage: 'Storage & Cache',
  monitoring: 'Monitoring & Observability',
  search: 'Search & Discovery',
  automation: 'Automation & Integration',
  tools: 'Developer Tools',
  other: 'Other',
};

const CATEGORY_COLORS: Record<string, string> = {
  database: '#4a9eff',
  messaging: '#f5a623',
  storage: '#7ed321',
  monitoring: '#f5a623',
  search: '#9013fe',
  automation: '#4a90d9',
  tools: '#50e3c2',
  other: '#9b9b9b',
};

export default function PluginHub() {
  const navigate = useNavigate();
  const toast = useToast();
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [available, setAvailable] = useState<PluginHubEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'installed' | 'available'>('installed');
  const [installing, setInstalling] = useState<string | null>(null);

  useEffect(() => {
    loadPlugins();
  }, []);

  async function loadPlugins() {
    setLoading(true);
    try {
      const [installedRes, availableRes] = await Promise.all([
        apiGet<{ plugins: InstalledPlugin[] }>('/api/plugins/installed'),
        apiGet<{ plugins: PluginHubEntry[] }>('/api/plugins/available'),
      ]);
      setInstalled(installedRes.plugins);
      setAvailable(availableRes.plugins);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load plugins';
      toast.push(msg, 'error');
    }
    setLoading(false);
  }

  async function handleInstall(id: string) {
    setInstalling(id);
    try {
      await apiPost(`/api/plugins/${id}/install`);
      toast.push('Plugin installed', 'success');
      await loadPlugins();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Install failed';
      toast.push(msg, 'error');
    }
    setInstalling(null);
  }

  async function handleUninstall(id: string) {
    try {
      await apiPost(`/api/plugins/${id}/uninstall`);
      toast.push('Plugin uninstalled', 'success');
      await loadPlugins();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Uninstall failed';
      toast.push(msg, 'error');
    }
  }

  async function handleToggle(id: string) {
    try {
      const res = await apiPost<{ enabled: boolean }>(`/api/plugins/${id}/toggle`);
      toast.push(res.enabled ? 'Plugin enabled' : 'Plugin disabled', 'success');
      await loadPlugins();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Toggle failed';
      toast.push(msg, 'error');
    }
  }

  function groupByCategory(items: Array<{ category: string }>): Record<string, any[]> {
    const grouped: Record<string, any[]> = {};
    for (const item of items) {
      const cat = item.category || 'other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(item);
    }
    return grouped;
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-label">System</div>
          <div className="topbar-value">Plugin Hub</div>
        </div>
        <div className="topbar-right">
          <span className="topbar-pill">{installed.length} installed</span>
        </div>
      </div>

      <div className="page-scroll">
        <div style={{ padding: 24, maxWidth: 900, margin: '0 auto', width: '100%' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, opacity: 0.5 }}>
              <div className="spinner" style={{ width: 24, height: 24, margin: '0 auto 12px' }} />
              <div style={{ fontSize: '0.8rem', color: '#666' }}>Loading plugins...</div>
            </div>
          ) : (
            <>
              <div className="plugin-tabs">
                <button
                  className={`plugin-tab ${activeTab === 'installed' ? 'active' : ''}`}
                  onClick={() => setActiveTab('installed')}
                >
                  Installed ({installed.length})
                </button>
                <button
                  className={`plugin-tab ${activeTab === 'available' ? 'active' : ''}`}
                  onClick={() => setActiveTab('available')}
                >
                  Available ({available.length})
                </button>
              </div>

              {activeTab === 'installed' && (
                <div className="plugin-categories">
                  {Object.entries(groupByCategory(installed)).map(([category, plugins]) => (
                    <div key={category} className="plugin-category-section">
                      <div className="plugin-category-header">
                        <span className="plugin-category-dot" style={{ background: CATEGORY_COLORS[category] || '#9b9b9b' }} />
                        <h3>{CATEGORY_LABELS[category] || category}</h3>
                        <span style={{ fontSize: '0.7rem', color: '#555', marginLeft: 'auto' }}>{plugins.length} plugin{plugins.length !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="plugin-grid">
                        {plugins.map((p: InstalledPlugin) => (
                          <div key={p.id} className={`plugin-card ${p.enabled ? '' : 'disabled'}`}>
                            <div className="plugin-card-header">
                              <span className="plugin-name">{p.name}</span>
                              <span className="plugin-version">v{p.version}</span>
                            </div>
                            <div className="plugin-desc">{p.description}</div>
                            <div className="plugin-status-row">
                              <span className={`plugin-status ${p.enabled ? 'enabled' : 'disabled'}`}>
                                {p.enabled ? 'Enabled' : 'Disabled'}
                              </span>
                              {p.isBuiltin && <span className="plugin-builtin-badge">Built-in</span>}
                            </div>
                            <div className="plugin-actions">
                              <button className="btn btn-sm btn-secondary" onClick={() => navigate(`/plugins/${p.id}`)}>
                                Configure
                              </button>
                              <button className="btn btn-sm btn-secondary" onClick={() => handleToggle(p.id)}>
                                {p.enabled ? 'Disable' : 'Enable'}
                              </button>
                              {!p.isBuiltin && (
                                <button className="btn btn-sm btn-ghost" style={{ color: '#c66' }} onClick={() => handleUninstall(p.id)}>
                                  Remove
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {installed.length === 0 && (
                    <div className="empty-state">
                      <p>No plugins installed yet.</p>
                      <p className="text-muted">Browse the Available tab to install plugins.</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'available' && (
                <div className="plugin-categories">
                  {Object.entries(groupByCategory(available)).map(([category, plugins]) => (
                    <div key={category} className="plugin-category-section">
                      <div className="plugin-category-header">
                        <span className="plugin-category-dot" style={{ background: CATEGORY_COLORS[category] || '#9b9b9b' }} />
                        <h3>{CATEGORY_LABELS[category] || category}</h3>
                        <span style={{ fontSize: '0.7rem', color: '#555', marginLeft: 'auto' }}>{plugins.length} plugin{plugins.length !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="plugin-grid">
                        {plugins.map((p: PluginHubEntry) => (
                          <div key={p.id} className="plugin-card available">
                            <div className="plugin-card-header">
                              <span className="plugin-name">{p.name}</span>
                              <span className="plugin-version">v{p.version}</span>
                            </div>
                            <div className="plugin-desc">{p.description}</div>
                            <div className="plugin-tags">
                              {p.tags.map((tag) => (
                                <span key={tag} className="plugin-tag">{tag}</span>
                              ))}
                            </div>
                            <div className="plugin-actions">
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => handleInstall(p.id)}
                                disabled={installing === p.id}
                              >
                                {installing === p.id ? 'Installing...' : 'Install'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {available.length === 0 && (
                    <div className="empty-state">
                      <p>All plugins are installed!</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
