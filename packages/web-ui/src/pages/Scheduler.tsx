import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiDelete } from '../api';
import { useToast } from '../components/ToastProvider';

interface Job {
  id: string;
  name: string;
  cron: string;
  instruction: string;
  nextRun?: string;
}

export default function Scheduler() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [cron, setCron] = useState('0 9 * * *');
  const [instruction, setInstruction] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      const res = await apiGet<{ jobs: Job[] }>('/api/scheduler/jobs');
      setJobs(res.jobs || []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load jobs';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addJob() {
    if (!name.trim() || !cron.trim() || !instruction.trim()) return;
    setSaving(true);
    try {
      await apiPost('/api/scheduler/jobs', {
        name: name.trim(),
        cron: cron.trim(),
        instruction: instruction.trim(),
      });
      setShowAdd(false);
      setName('');
      setCron('0 9 * * *');
      setInstruction('');
      await load();
      try { toast.push('Job scheduled', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to add job';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
    setSaving(false);
  }

  async function removeJob(id: string) {
    try {
      await apiDelete(`/api/scheduler/jobs/${id}`);
      await load();
      try { toast.push('Job removed', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to remove job';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  function formatNextRun(next?: string): string {
    if (!next) return 'Unknown';
    try {
      return new Date(next).toLocaleString();
    } catch {
      return next;
    }
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-label">Scheduler</div>
          <div className="topbar-value">{jobs.length} job{jobs.length !== 1 ? 's' : ''}</div>
        </div>
        <div className="topbar-right">
          <button className="btn btn-sm btn-primary" onClick={() => setShowAdd(true)}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ width: 12, height: 12, marginRight: 4, verticalAlign: 'middle' }}>
              <path d="M8 3v10M3 8h10"/>
            </svg>
            New Job
          </button>
        </div>
      </div>

      <div className="page-scroll">
        <div style={{ padding: 24, maxWidth: 800, margin: '0 auto', width: '100%' }}>
          {loading && jobs.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: '#555', fontSize: '0.85rem' }}>
              <div className="spinner" style={{ margin: '0 auto 16px' }} />
              Loading jobs...
            </div>
          )}

          {!loading && jobs.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 48 }}>
              <div style={{ fontSize: '2rem', marginBottom: 12, opacity: 0.3 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ width: 48, height: 48 }}>
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
              </div>
              <div style={{ fontSize: '0.9rem', color: '#888', marginBottom: 8 }}>No scheduled jobs</div>
              <div style={{ fontSize: '0.75rem', color: '#555' }}>Create recurring tasks that run on a cron schedule</div>
            </div>
          )}

          {jobs.map((job) => (
            <div key={job.id} className="card mb-16">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: '0.9rem', color: '#ccc', fontWeight: 500 }}>{job.name}</div>
                  <div style={{ fontSize: '0.7rem', color: '#666', marginTop: 2, fontFamily: 'monospace' }}>{job.cron}</div>
                </div>
                <button className="btn btn-sm btn-ghost" style={{ color: '#c66' }} onClick={() => removeJob(job.id)}>
                  Remove
                </button>
              </div>
              <div style={{ fontSize: '0.8rem', color: '#888', lineHeight: 1.5, marginBottom: 8 }}>{job.instruction}</div>
              <div style={{ fontSize: '0.7rem', color: '#555' }}>Next run: {formatNextRun(job.nextRun)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Add job modal */}
      {showAdd && (
        <div className="overlay" onClick={() => setShowAdd(false)}>
          <div className="overlay-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <button className="overlay-close" onClick={() => setShowAdd(false)}>✕</button>
            <div className="overlay-title">New Scheduled Job</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="field">
                <label className="label">Job Name</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Daily summary" />
              </div>
              <div className="field">
                <label className="label">Cron Expression</label>
                <input className="input" value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 9 * * *" />
                <div style={{ fontSize: '0.7rem', color: '#555', marginTop: 4 }}>
                  Examples: <code style={{ color: '#aaa' }}>0 9 * * *</code> daily 9am, <code style={{ color: '#aaa' }}>*/15 * * * *</code> every 15 min
                </div>
              </div>
              <div className="field">
                <label className="label">Instruction</label>
                <textarea
                  className="input"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="What should the agent do when this job runs?"
                  rows={4}
                  style={{ resize: 'vertical', minHeight: 80 }}
                />
              </div>
              <div className="wizard-actions" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={addJob} disabled={saving || !name.trim() || !cron.trim() || !instruction.trim()}>
                  {saving ? 'Saving...' : 'Schedule Job'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
