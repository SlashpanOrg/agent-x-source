/** Trace export toolbar (§11.12) — format selector + download + copy + open as text with auto-diagnosis. */
import { useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Snackbar from '@mui/material/Snackbar';
import DownloadIcon from '@mui/icons-material/Download';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DescriptionIcon from '@mui/icons-material/Description';
import { getTraceExportBundle } from '../api';
import type { TraceDetail, TraceExportBundle, TraceDiagnosis, SpanNode } from '@agentx/shared';
import { obs, obsMonoSx, obsOverlineSx } from '../obs-theme';
import { alphaColor } from '../../theme';

export function TraceExportBar({ traceId, trace, capturePrompts }: { traceId: string; trace?: TraceDetail; capturePrompts: boolean }) {
  const [format, setFormat] = useState<'json' | 'markdown'>('markdown');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewText, setPreviewText] = useState('');
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(false);

  const build = useCallback(async (): Promise<string> => {
    const bundle = await getTraceExportBundle(traceId);
    if (trace) {
      bundle.diagnosis = buildDiagnosis(trace);
    }
    return format === 'json' ? JSON.stringify(bundle, null, 2) : renderMarkdown(bundle);
  }, [traceId, trace, format]);

  const download = useCallback(async () => {
    setLoading(true);
    try {
      const text = await build();
      const ext = format === 'json' ? 'json' : 'md';
      const filename = `agentx-trace-${traceId}.${ext}`;
      // Try File System Access API (Chromium).
      const w = window as unknown as { showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle> };
      if (w.showSaveFilePicker) {
        const handle = await w.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: format === 'json' ? 'JSON' : 'Markdown', accept: { 'application/json': ['.json'], 'text/markdown': ['.md'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
        setToast(`Saved ${filename}`);
      } else {
        // Fallback: trigger a browser download.
        const blob = new Blob([text], { type: format === 'json' ? 'application/json' : 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
        setToast(`Downloaded ${filename}`);
      }
    } catch (e: unknown) {
      setToast(`Export failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [build, traceId, format]);

  const copyToClipboard = useCallback(async () => {
    setLoading(true);
    try {
      const text = await build();
      await navigator.clipboard.writeText(text);
      setToast(`Copied ${text.length} chars to clipboard`);
    } catch (e: unknown) {
      setToast(`Copy failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [build]);

  const openAsText = useCallback(async () => {
    setLoading(true);
    try {
      const text = await build();
      setPreviewText(text);
      setPreviewOpen(true);
    } catch (e: unknown) {
      setToast(`Preview failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [build]);

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <ToggleButtonGroup
        size="small"
        value={format}
        exclusive
        onChange={(_, v: 'json' | 'markdown' | null) => v && setFormat(v)}
      >
        <ToggleButton value="markdown">MD</ToggleButton>
        <ToggleButton value="json">JSON</ToggleButton>
      </ToggleButtonGroup>
      <Box
        component="span"
        sx={{
          ...obsMonoSx, fontSize: '0.56rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
          px: 0.6, py: 0.2, borderRadius: '3px',
          color: capturePrompts ? obs.accent.signal : obs.text.dim,
          border: `1px solid ${alphaColor(capturePrompts ? obs.accent.signal : obs.text.dim, 0.4)}`,
          bgcolor: alphaColor(capturePrompts ? obs.accent.signal : obs.text.dim, 0.1),
        }}
      >
        {capturePrompts ? 'Prompts visible' : 'Redacted'}
      </Box>
      <Tooltip title="Download">
        <IconButton size="small" onClick={download} disabled={loading} sx={{ color: obs.text.dim, '&:hover': { color: obs.accent.hud } }}><DownloadIcon sx={{ fontSize: 16 }} /></IconButton>
      </Tooltip>
      <Tooltip title="Copy to clipboard">
        <IconButton size="small" onClick={copyToClipboard} disabled={loading} sx={{ color: obs.text.dim, '&:hover': { color: obs.accent.hud } }}><ContentCopyIcon sx={{ fontSize: 16 }} /></IconButton>
      </Tooltip>
      <Tooltip title="Open as text">
        <IconButton size="small" onClick={openAsText} disabled={loading} sx={{ color: obs.text.dim, '&:hover': { color: obs.accent.hud } }}><DescriptionIcon sx={{ fontSize: 16 }} /></IconButton>
      </Tooltip>
      <Snackbar
        open={!!toast}
        autoHideDuration={3000}
        onClose={() => setToast('')}
        message={toast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} maxWidth="md" fullWidth PaperProps={{ sx: { bgcolor: obs.bg.void, border: `1px solid ${obs.border.default}` } }}>
        <DialogTitle sx={{ ...obsOverlineSx, fontSize: '0.68rem', color: obs.text.primary, borderBottom: `1px solid ${obs.border.subtle}` }}>
          Trace export preview ({format})
        </DialogTitle>
        <DialogContent>
          <Box component="pre" className="ax-scroll" sx={{ ...obsMonoSx, fontSize: '0.68rem', color: obs.text.secondary, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '70vh' }}>
            {previewText}
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  );
}

function flattenSpans(spans: SpanNode[]): SpanNode[] {
  const out: SpanNode[] = [];
  const walk = (s: SpanNode) => { out.push(s); s.children?.forEach(walk); };
  spans.forEach(walk);
  return out;
}

function spanDepth(span: SpanNode, byId: Map<string, SpanNode>): number {
  let d = 0;
  let cur: SpanNode | undefined = span;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.span_id)) {
    seen.add(cur.span_id);
    d++;
    cur = cur.parent_span_id ? byId.get(cur.parent_span_id) : undefined;
  }
  return d;
}

function buildDiagnosis(trace: TraceDetail): TraceDiagnosis {
  const all = flattenSpans(trace.spans);
  const byId = new Map<string, SpanNode>(all.map((s) => [s.span_id, s]));
  const failing = all.filter((s) => s.status === 'error');

  let rootCause: SpanNode | undefined;
  if (failing.length) {
    let deepest = failing[0];
    let deepestDepth = spanDepth(deepest, byId);
    for (const s of failing) {
      const d = spanDepth(s, byId);
      if (d > deepestDepth || (d === deepestDepth && s.started_at < deepest.started_at)) {
        deepest = s;
        deepestDepth = d;
      }
    }
    rootCause = deepest;
  }

  const chainOfEvents: string[] = [];
  if (rootCause) {
    const path: SpanNode[] = [];
    let cur: SpanNode | undefined = rootCause;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.span_id)) {
      seen.add(cur.span_id);
      path.push(cur);
      cur = cur.parent_span_id ? byId.get(cur.parent_span_id) : undefined;
    }
    path.reverse().forEach((s) => chainOfEvents.push(`${s.name} (${s.status})`));
  }

  const errorMessages = new Set<string>();
  if (trace.error) errorMessages.add(trace.error);
  for (const s of failing) {
    const err = s.attributes?.error;
    if (err) errorMessages.add(String(err));
    for (const ev of s.events ?? []) {
      if (ev.name === 'exception') {
        const payload = ev.attributes;
        if (payload) {
          const ex = payload['exception'];
          const exObj = typeof ex === 'object' && ex !== null ? (ex as { message?: unknown }) : undefined;
          const msg = payload['message'] ?? exObj?.message ?? payload['exception.message'];
          if (msg) errorMessages.add(String(msg));
        }
      }
    }
  }

  const slowest = all.length
    ? all.reduce((a, b) => ((b.duration_ms ?? 0) > (a.duration_ms ?? 0) ? b : a))
    : undefined;

  const toolCalls = all
    .filter((s) => s.kind === 'tool')
    .map((s) => ({ name: s.name, success: s.status !== 'error', elapsed_ms: s.duration_ms ?? 0 }));
  const toolFailures = toolCalls.filter((t) => !t.success);

  const suggested: string[] = [];
  if (failing.length) {
    suggested.push(`${failing.length} span${failing.length === 1 ? '' : 's'} failed. Review the failing spans and their attributes.`);
  }
  if (slowest) {
    suggested.push(`Slowest span: ${slowest.name} (${slowest.duration_ms ?? 0}ms). Investigate latency.`);
  }
  if (toolFailures.length) {
    suggested.push(`Tool failures: ${toolFailures.map((t) => t.name).join(', ')}. Inspect tool.args and tool.output.`);
  }
  if (errorMessages.size) {
    suggested.push(`Errors: ${[...errorMessages].join('; ')}`);
  }

  return {
    status: trace.status,
    failing_spans: failing,
    root_cause_span: rootCause,
    error_messages: [...errorMessages],
    chain_of_events: chainOfEvents,
    token_usage: {
      input: trace.input_tokens ?? 0,
      output: trace.output_tokens ?? 0,
      total: (trace.input_tokens ?? 0) + (trace.output_tokens ?? 0),
    },
    tool_calls: toolCalls,
    suggested_investigation: suggested,
  };
}

function renderMarkdown(bundle: TraceExportBundle): string {
  const { trace, diagnosis, spans, logs, metrics } = bundle;
  const allSpans = flattenSpans(spans);
  const slowest = allSpans.length
    ? allSpans.reduce((a, b) => ((b.duration_ms ?? 0) > (a.duration_ms ?? 0) ? b : a))
    : undefined;

  const lines: string[] = [];
  lines.push(`# Agent-X Trace Export`);
  lines.push('');
  lines.push(`**Trace ID:** ${trace.trace_id}  `);
  lines.push(`**Status:** ${trace.status}  `);
  lines.push(`**Started:** ${new Date(trace.started_at).toISOString()}  `);
  lines.push(`**Duration:** ${trace.duration_ms != null ? `${trace.duration_ms}ms` : '—'}  `);
  lines.push(`**Session:** ${trace.session_id ?? '—'}  `);
  lines.push(`**Tokens:** ${trace.input_tokens ?? 0} in / ${trace.output_tokens ?? 0} out  `);
  lines.push(`**Cost:** $${(trace.cost_usd ?? 0).toFixed(6)}  `);
  lines.push('');

  lines.push('## Diagnosis');
  lines.push('');
  lines.push(`- **Status:** ${diagnosis.status}`);
  lines.push(`- **Error count:** ${diagnosis.failing_spans.length}`);
  lines.push(`- **Root cause span:** ${diagnosis.root_cause_span ? `${diagnosis.root_cause_span.name} (${diagnosis.root_cause_span.status})` : 'none'}`);
  lines.push(`- **Slowest span:** ${slowest ? `${slowest.name} (${slowest.duration_ms ?? 0}ms)` : '—'}`);
  lines.push(`- **Tool failures:** ${diagnosis.tool_calls.filter((t) => !t.success).length}`);
  if (diagnosis.error_messages.length) {
    lines.push(`- **Error messages:** ${diagnosis.error_messages.join('; ')}`);
  }
  if (diagnosis.suggested_investigation.length) {
    lines.push('');
    lines.push('### Suggested investigation');
    diagnosis.suggested_investigation.forEach((s) => lines.push(`- ${s}`));
  }
  lines.push('');

  lines.push('## Spans');
  lines.push('');
  allSpans.forEach((s) => {
    const depth = spanDepth(s, new Map(allSpans.map((x) => [x.span_id, x])));
    const indent = '  '.repeat(Math.max(0, depth - 1));
    lines.push(`${indent}- ${s.name} | ${s.status} | ${s.duration_ms != null ? `${s.duration_ms}ms` : '—'}`);
  });
  lines.push('');

  lines.push('## Logs');
  lines.push('');
  if (logs.length === 0) {
    lines.push('_No logs._');
  } else {
    logs.slice(0, 200).forEach((l) => {
      lines.push(`- \`${new Date(l.ts).toISOString()}\` **[${l.level}]** ${l.scope ? `(${l.scope}) ` : ''}${l.message}`);
    });
  }
  lines.push('');

  lines.push('## Metrics');
  lines.push('');
  if (metrics.length === 0) {
    lines.push('_No metrics._');
  } else {
    metrics.forEach((m) => {
      const ts = m.timestamp ? new Date(m.timestamp).toISOString() : '—';
      const labelMap = m.labels ? Object.entries(m.labels).map(([k, v]) => `${k}=${v}`).join(',') : '';
      lines.push(`- \`${ts}\` **${m.name}**${labelMap ? ` {${labelMap}}` : ''} = ${m.value}`);
    });
  }

  return lines.join('\n');
}
