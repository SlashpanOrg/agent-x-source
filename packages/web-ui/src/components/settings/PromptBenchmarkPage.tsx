import { useState, useCallback, useRef } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import { settingsTheme, settingsMonoSx, settingsBtnPrimarySx, settingsBtnGhostSx, settingsHelperSx } from '../../styles/settings-theme';
import { SettingsCard } from './SettingsCard';
import { SettingsSectionHeader } from './SettingsSectionHeader';
import { CheckCircle } from '../CheckCircle';

interface PromptBenchmarkResult {
  runId: string;
  modelId: string;
  workspace: string;
  startedAt: string;
  completedAt?: string;
  totalTurns: number;
  passed: number;
  warned: number;
  failed: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgTotalTokens: number;
  avgLatencyMs: number;
  turns: Array<{
    id: string;
    category: string;
    status: 'pass' | 'fail' | 'warn';
    notes: string[];
    latencyMs: number;
    totalTokens: number;
  }>;
}

interface ProgressState {
  current: number;
  total: number;
  status: string;
  fixtureId: string;
}

export function PromptBenchmarkPage() {
  const [workspace, setWorkspace] = useState('');
  const [picking, setPicking] = useState(false);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<PromptBenchmarkResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState<ProgressState>({ current: 0, total: 0, status: 'Idle', fixtureId: '' });
  const resultRef = useRef<PromptBenchmarkResult | null>(null);

  const addLog = useCallback((line: string) => {
    setLogs((prev) => [...prev, line]);
  }, []);

  const runBenchmark = async () => {
    if (!workspace.trim()) {
      addLog('ERROR: Please select an isolated workspace folder');
      return;
    }
    setRunning(true);
    setLogs([]);
    setResult(null);
    resultRef.current = null;
    setCopied(false);
    setProgress({ current: 0, total: 0, status: 'Starting benchmark…', fixtureId: '' });

    try {
      const body = { workspace: workspace.trim() };

      const startRes = await fetch('/api/dev/prompt-benchmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!startRes.ok) {
        const err = await startRes.json().catch(() => ({ message: startRes.statusText }));
        addLog(`ERROR: ${String(err.message ?? err.error ?? 'start failed')}`);
        setRunning(false);
        setProgress((p) => ({ ...p, status: 'Failed to start' }));
        return;
      }
      const { runId, total } = (await startRes.json()) as { runId: string; total: number };
      setProgress({ current: 0, total: total || 1, status: `Running 0 of ${total}`, fixtureId: '' });
      addLog(`Started benchmark run ${runId} — ${total} turns`);

      const es = new EventSource(`/api/dev/prompt-benchmark/${runId}/stream`);

      es.addEventListener('started', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as { total?: number };
          setProgress({ current: 0, total: data.total ?? 0, status: `Running 0 of ${data.total ?? 0}`, fixtureId: '' });
          addLog(`Benchmark suite started — ${data.total ?? 0} turns`);
        } catch {
          addLog(`started: ${e.data}`);
        }
      });

      es.addEventListener('turn_start', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as { current?: number; total?: number; fixtureId?: string };
          const current = data.current ?? 0;
          const total = data.total ?? 0;
          const fixtureId = data.fixtureId ?? '';
          setProgress({ current, total, status: `Running turn ${current} of ${total}: ${fixtureId}`, fixtureId });
          addLog(`[${current}/${total}] Starting ${fixtureId}…`);
        } catch {
          addLog(`turn_start: ${e.data}`);
        }
      });

      es.addEventListener('turn_complete', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as { current?: number; total?: number; fixtureId?: string; status?: string; notes?: string[] };
          const current = data.current ?? 0;
          const total = data.total ?? 0;
          const fixtureId = data.fixtureId ?? '';
          const status = data.status ?? 'done';
          const notes = data.notes?.join('; ') || '-';
          setProgress({ current, total, status: `Completed turn ${current} of ${total}: ${fixtureId} (${status})`, fixtureId });
          addLog(`[${current}/${total}] ${fixtureId}: ${status} — ${notes}`);
        } catch {
          addLog(`turn_complete: ${e.data}`);
        }
      });

      es.addEventListener('complete', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as { result?: PromptBenchmarkResult };
          if (data.result) {
            resultRef.current = data.result;
            setResult(data.result);
            setProgress({
              current: data.result.totalTurns,
              total: data.result.totalTurns,
              status: `Complete — ${data.result.passed}/${data.result.totalTurns} passed`,
              fixtureId: '',
            });
            addLog(`Benchmark complete — ${data.result.passed}/${data.result.totalTurns} passed`);
          }
        } catch {
          addLog(`complete: ${e.data}`);
        }
        es.close();
        setRunning(false);
      });

      es.addEventListener('error', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as { message?: string; error?: string };
          const message = data.message ?? data.error ?? 'unknown error';
          addLog(`ERROR: ${message}`);
          setProgress((p) => ({ ...p, status: `Error: ${message}` }));
        } catch {
          addLog('SSE error event received');
        }
        es.close();
        setRunning(false);
      });

      es.onerror = () => {
        addLog('SSE stream closed or errored');
        es.close();
        setRunning(false);
      };
    } catch (e) {
      addLog(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
      setProgress((p) => ({ ...p, status: 'Failed to connect' }));
      setRunning(false);
    }
  };

  const copyReport = () => {
    const r = resultRef.current ?? result;
    if (!r) return;
    const lines: string[] = [
      '# Prompt Benchmark Report',
      `Model: ${r.modelId}`,
      `Workspace: ${r.workspace}`,
      `Total turns: ${r.totalTurns}`,
      `Pass rate: ${((r.passed / r.totalTurns) * 100).toFixed(1)}% (${r.passed}/${r.totalTurns})`,
      `Avg total tokens: ${r.avgTotalTokens}`,
      `Avg latency: ${r.avgLatencyMs}ms`,
      '',
      '## Turn Results',
      '| ID | Category | Status | Tokens | Latency | Notes |',
      '|----|----------|--------|--------|---------|-------|',
      ...r.turns.map((t) => `| ${t.id} | ${t.category} | ${t.status} | ${t.totalTokens} | ${t.latencyMs}ms | ${t.notes.join('; ') || '-'} |`),
    ];
    const text = lines.join('\n');
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const progressPercent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <Box>
      <SettingsSectionHeader title="Prompt Benchmark" subtitle="Measure prompt assembler changes against real model turns" />
      <SettingsCard>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box>
            <Button
              variant="outlined"
              disabled={picking}
              onClick={async () => {
                setPicking(true);
                try {
                  const chosen = await window.agentx?.openFolder();
                  if (chosen) setWorkspace(chosen);
                } finally {
                  setPicking(false);
                }
              }}
              sx={settingsBtnGhostSx}
            >
              {picking ? <CircularProgress size={14} sx={{ color: 'inherit', mr: 1 }} /> : null}
              {picking ? 'Opening…' : 'Choose Folder'}
            </Button>
            {workspace && (
              <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.text.dim, mt: 1, ...settingsMonoSx }}>
                {workspace}
              </Typography>
            )}
          </Box>

          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <Button variant="contained" onClick={runBenchmark} disabled={!workspace || running || picking} sx={settingsBtnPrimarySx}>
              {running ? <CircularProgress size={14} sx={{ color: 'inherit', mr: 1 }} /> : null}
              {running ? 'Running…' : 'Benchmark'}
            </Button>
            {result && (
              <Button variant="outlined" onClick={copyReport} sx={settingsBtnGhostSx}>
                {copied ? <CheckCircle size={14} color={settingsTheme.accent.signal} /> : 'Copy Report'}
              </Button>
            )}
          </Box>

          {(running || result) && (
            <Box>
              <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.text.dim, mb: 0.5, ...settingsMonoSx }}>
                {progress.status}
              </Typography>
              <LinearProgress
                variant={progress.total > 0 ? 'determinate' : 'indeterminate'}
                value={progressPercent}
                sx={{
                  height: 6,
                  borderRadius: '3px',
                  bgcolor: settingsTheme.bg.inset,
                  '& .MuiLinearProgress-bar': { bgcolor: settingsTheme.accent.hud },
                }}
              />
              <Typography sx={{ fontSize: '0.55rem', color: settingsTheme.text.dim, mt: 0.5, ...settingsMonoSx }}>
                {progress.total > 0 ? `${progressPercent}% complete` : 'Initializing…'}
              </Typography>
            </Box>
          )}

          <Typography sx={{ ...settingsHelperSx, fontSize: '0.6rem' }}>
            Choose an isolated folder. The benchmark will run preset turns with tool permissions bypassed, but file access is still scoped to this folder.
          </Typography>
        </Box>
      </SettingsCard>

      {(logs.length > 0 || result) && (
        <SettingsCard>
          <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.text.dim, mb: 1, ...settingsMonoSx }}>
            LOG
          </Typography>
          <Box
            className="ax-scroll"
            sx={{
              maxHeight: 320,
              bgcolor: settingsTheme.bg.inset,
              border: `1px solid ${settingsTheme.border.default}`,
              borderRadius: '6px',
              p: 1.5,
              overflow: 'auto',
            }}
          >
            {logs.map((l, i) => (
              <Typography key={i} sx={{ fontSize: '0.6rem', fontFamily: 'monospace', color: settingsTheme.text.primary, whiteSpace: 'pre-wrap' }}>
                {l}
              </Typography>
            ))}
          </Box>
          {result && (
            <Box sx={{ mt: 2, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              <StatusChip label="Passed" value={result.passed} color={settingsTheme.accent.signal} />
              <StatusChip label="Warned" value={result.warned} color={settingsTheme.accent.amber} />
              <StatusChip label="Failed" value={result.failed} color={settingsTheme.accent.alert} />
              <StatusChip label="Avg tokens" value={result.avgTotalTokens} color={settingsTheme.accent.hud} />
              <StatusChip label="Avg latency" value={`${result.avgLatencyMs}ms`} color={settingsTheme.accent.hud} />
            </Box>
          )}
        </SettingsCard>
      )}
    </Box>
  );
}

function StatusChip({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <Box>
      <Typography sx={{ fontSize: '0.55rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>{label}</Typography>
      <Typography sx={{ fontSize: '0.75rem', color, fontWeight: 700, ...settingsMonoSx }}>{value}</Typography>
    </Box>
  );
}
