import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiDelete } from '../api';
import { useToast } from '../components/ToastProvider';

interface RAGResult {
  id: string;
  score: number;
  content: string;
  metadata?: Record<string, unknown>;
}

export default function RAGAdmin() {
  const [enabled, setEnabled] = useState(false);
  const [indexedChunks, setIndexedChunks] = useState(0);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RAGResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [content, setContent] = useState('');
  const [indexing, setIndexing] = useState(false);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  async function loadStatus() {
    setLoading(true);
    try {
      const res = await apiGet<{ enabled: boolean; indexedChunks: number }>('/api/rag/status');
      setEnabled(res.enabled);
      setIndexedChunks(res.indexedChunks);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load RAG status';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
    setLoading(false);
  }

  useEffect(() => { loadStatus(); }, []);

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await apiPost<{ results: RAGResult[] }>('/api/rag/search', { query: query.trim(), topK: 5 });
      setResults(res.results || []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Search failed';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
      setResults([]);
    }
    setSearching(false);
  }

  async function indexContent() {
    if (!content.trim()) return;
    setIndexing(true);
    try {
      await apiPost('/api/rag/index', { content: content.trim() });
      setContent('');
      await loadStatus();
      try { toast.push('Document indexed', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Index failed';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
    setIndexing(false);
  }

  async function clearAll() {
    try {
      await apiPost('/api/rag/clear');
      await loadStatus();
      setResults([]);
      try { toast.push('Index cleared', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Clear failed';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-label">RAG</div>
          <div className="topbar-value">
            {loading ? 'Loading...' : enabled ? `${indexedChunks} chunks` : 'Disabled'}
          </div>
        </div>
      </div>

      <div className="page-scroll">
        <div style={{ padding: 24, maxWidth: 800, margin: '0 auto', width: '100%' }}>
          {!enabled && !loading && (
            <div className="card" style={{ textAlign: 'center', padding: 40, marginBottom: 24 }}>
              <div style={{ fontSize: '1.1rem', color: '#888', marginBottom: 8 }}>RAG is not enabled</div>
              <div style={{ fontSize: '0.8rem', color: '#555', lineHeight: 1.6 }}>
                Enable RAG in your configuration to use retrieval-augmented generation.
                The agent will be able to search indexed documents to answer questions.
              </div>
            </div>
          )}

          {enabled && (
            <>
              {/* Index new content */}
              <div className="card mb-16">
                <div className="card-title mb-16">Index Document</div>
                <div className="field">
                  <label className="label">Content</label>
                  <textarea
                    className="input"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Paste text to index..."
                    rows={6}
                    style={{ resize: 'vertical', minHeight: 120 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn btn-sm btn-secondary" onClick={() => setContent('')}>Clear</button>
                  <button className="btn btn-sm btn-primary" onClick={indexContent} disabled={indexing || !content.trim()}>
                    {indexing ? 'Indexing...' : 'Index Content'}
                  </button>
                </div>
              </div>

              {/* Search */}
              <div className="card mb-16">
                <div className="card-title mb-16">Search Index</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <input
                    className="input"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && search()}
                    placeholder="Enter search query..."
                    style={{ flex: 1 }}
                  />
                  <button className="btn btn-sm btn-primary" onClick={search} disabled={searching || !query.trim()}>
                    {searching ? 'Searching...' : 'Search'}
                  </button>
                </div>

                {results.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {results.map((r, i) => (
                      <div key={r.id || i} style={{ padding: 12, background: '#0a0a0a', borderRadius: 6, border: '1px solid #151515' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{ fontSize: '0.7rem', color: '#666', fontFamily: 'monospace' }}>{r.id}</span>
                          <span style={{ fontSize: '0.7rem', color: '#888' }}>Score: {(r.score * 100).toFixed(1)}%</span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#aaa', lineHeight: 1.5 }}>{r.content}</div>
                      </div>
                    ))}
                  </div>
                )}

                {results.length === 0 && query && !searching && (
                  <div style={{ textAlign: 'center', padding: 24, color: '#555', fontSize: '0.8rem' }}>No results found</div>
                )}
              </div>

              {/* Danger zone */}
              <div className="card" style={{ borderColor: '#2a1a1a' }}>
                <div className="card-title mb-16" style={{ color: '#ff6b6b' }}>Danger Zone</div>
                <div style={{ fontSize: '0.82rem', color: '#888', lineHeight: 1.6, marginBottom: 12 }}>
                  <strong style={{ color: '#aaa' }}>Clear All Index</strong>
                  <br />Removes all indexed documents from the vector store. This cannot be undone.
                </div>
                <button className="btn btn-sm btn-secondary" style={{ borderColor: '#442222', color: '#ff6b6b' }} onClick={clearAll}>
                  Clear All
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
