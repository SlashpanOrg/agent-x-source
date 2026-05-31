import { useEffect, useState } from 'react';
import { apiGet, apiDelete } from '../api';
import { useToast } from '../components/ToastProvider';

interface FileItem {
  id: string;
  name: string;
  size: number;
  createdAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function FileManager() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      const res = await apiGet<{ files: FileItem[] }>('/api/files');
      setFiles(res.files || []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load files';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function deleteFile(id: string) {
    try {
      await apiDelete(`/api/files/${id}`);
      setDeleteConfirm(null);
      await load();
      try { toast.push('File deleted', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to delete file';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  function downloadUrl(id: string): string {
    return `/api/files/${id}`;
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-label">Files</div>
          <div className="topbar-value">{files.length} uploaded</div>
        </div>
        <div className="topbar-right">
          <button className="btn btn-sm btn-primary" onClick={load} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="page-scroll">
        <div style={{ padding: 24, maxWidth: 800, margin: '0 auto', width: '100%' }}>
          {loading && files.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: '#555', fontSize: '0.85rem' }}>
              <div className="spinner" style={{ margin: '0 auto 16px' }} />
              Loading files...
            </div>
          )}

          {!loading && files.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 48 }}>
              <div style={{ fontSize: '2rem', marginBottom: 12, opacity: 0.3 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ width: 48, height: 48 }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
              </div>
              <div style={{ fontSize: '0.9rem', color: '#888', marginBottom: 8 }}>No files uploaded yet</div>
              <div style={{ fontSize: '0.75rem', color: '#555' }}>Attach files in the Chat page to see them here</div>
            </div>
          )}

          {files.length > 0 && (
            <div className="card">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {files.map((f) => (
                  <div key={f.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                    borderBottom: '1px solid #111',
                  }}>
                    <div style={{ flexShrink: 0, color: '#666' }}>
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 18, height: 18 }}>
                        <path d="M8.5 2.5v8a2.5 2.5 0 1 1-5 0v-6a1.5 1.5 0 0 1 3 0v5"/>
                      </svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.85rem', color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                      <div style={{ fontSize: '0.7rem', color: '#555', marginTop: 2 }}>
                        {formatBytes(f.size)} · {new Date(f.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <a
                        href={downloadUrl(f.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-sm btn-ghost"
                        style={{ padding: '4px 10px', fontSize: '0.7rem' }}
                        download={f.name}
                      >
                        Download
                      </a>
                      {deleteConfirm === f.id ? (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <span style={{ fontSize: '0.65rem', color: '#888' }}>Delete?</span>
                          <button className="btn btn-sm btn-ghost" style={{ color: '#c66', padding: '2px 6px', fontSize: '0.65rem' }} onClick={() => deleteFile(f.id)}>Yes</button>
                          <button className="btn btn-sm btn-ghost" style={{ padding: '2px 6px', fontSize: '0.65rem' }} onClick={() => setDeleteConfirm(null)}>No</button>
                        </div>
                      ) : (
                        <button className="btn btn-sm btn-ghost" style={{ padding: '4px 10px', fontSize: '0.7rem', color: '#c66' }} onClick={() => setDeleteConfirm(f.id)}>
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
