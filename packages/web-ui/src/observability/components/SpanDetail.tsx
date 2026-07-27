/** Span detail drawer (§11.5) — slides in from the right with tabbed content. */
import { useState, useEffect } from 'react';
import Drawer from '@mui/material/Drawer';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import type { SpanNode, ObservabilityLogEntry } from '@agentx/shared';
import { StatusBadge } from './StatusBadge';
import { CopyButton } from './CopyButton';
import { JsonViewer } from './JsonViewer';
import { getSpanKindColor } from './SpanKindLegend';
import { obs, obsMonoSx, LOG_LEVEL_COLORS } from '../obs-theme';
import { alphaColor } from '../../theme';

export function SpanDetail({
  span,
  traceId,
  logs,
  onClose,
  onSelectSpan,
}: {
  span: SpanNode | null;
  traceId: string;
  logs: ObservabilityLogEntry[];
  onClose: () => void;
  onSelectSpan: (span: SpanNode) => void;
}) {
  const [tab, setTab] = useState(0);

  useEffect(() => { setTab(0); }, [span?.span_id]);

  if (!span) return null;

  const spanLogs = logs.filter((l) => l.span_id === span.span_id);
  const childSpans = span.children ?? [];
  const kindColor = getSpanKindColor(span.kind);

  return (
    <Drawer
      anchor="right"
      open={!!span}
      onClose={onClose}
      variant="temporary"
      sx={{ '& .MuiDrawer-paper': { width: 460, p: 2, display: 'flex', flexDirection: 'column', bgcolor: obs.bg.panel } }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: kindColor, flexShrink: 0 }} />
          <Typography sx={{ ...obsMonoSx, fontSize: '0.74rem', fontWeight: 700, color: obs.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {span.name}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose} sx={{ color: obs.text.dim, flexShrink: 0 }}><CloseIcon fontSize="small" /></IconButton>
      </Box>

      <Box sx={{ display: 'flex', gap: 0.6, mb: 1.25, flexWrap: 'wrap', alignItems: 'center' }}>
        <StatusBadge status={span.status} />
        <ChipTag label={span.kind} color={kindColor} />
        <ChipTag label={`${span.duration_ms ?? 0}ms`} />
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1 }}>
        <IdRow label="span_id" value={span.span_id} />
        <IdRow label="trace_id" value={traceId} />
        {span.parent_span_id && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography sx={{ ...obsMonoSx, fontSize: '0.6rem', color: obs.text.dim, width: 62, flexShrink: 0 }}>parent</Typography>
            <Typography sx={{ ...obsMonoSx, fontSize: '0.62rem', color: obs.accent.hud }}>
              {span.parent_span_id.slice(0, 16)}…
            </Typography>
          </Box>
        )}
      </Box>

      <Box sx={{ height: '1px', bgcolor: obs.border.subtle, my: 1 }} />

      {/* Tabs */}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons={false}>
        <Tab label="Overview" />
        <Tab label="Attributes" />
        <Tab label="Events" />
        <Tab label={`Logs${spanLogs.length ? ` (${spanLogs.length})` : ''}`} />
        <Tab label={`Children${childSpans.length ? ` (${childSpans.length})` : ''}`} />
      </Tabs>

      <Box className="ax-scroll" sx={{ flex: 1, minHeight: 0, pt: 1.25 }}>
        {tab === 0 && <OverviewTab span={span} />}
        {tab === 1 && <JsonViewer data={span.attributes ?? {}} />}
        {tab === 2 && <EventsTab span={span} />}
        {tab === 3 && <LogsTab logs={spanLogs} />}
        {tab === 4 && <ChildrenTab children={childSpans} onSelect={onSelectSpan} />}
      </Box>
    </Drawer>
  );
}

function ChipTag({ label, color }: { label: string; color?: string }) {
  const c = color ?? obs.text.dim;
  return (
    <Box
      component="span"
      sx={{
        ...obsMonoSx, fontSize: '0.58rem', fontWeight: 600, px: 0.65, py: 0.15,
        borderRadius: '3px', color: c, bgcolor: alphaColor(c, 0.12), border: `1px solid ${alphaColor(c, 0.35)}`,
      }}
    >
      {label}
    </Box>
  );
}

function IdRow({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Typography sx={{ ...obsMonoSx, fontSize: '0.6rem', color: obs.text.dim, width: 62, flexShrink: 0 }}>{label}</Typography>
      <Typography sx={{ ...obsMonoSx, fontSize: '0.62rem', color: obs.text.secondary }}>{value.slice(0, 16)}…</Typography>
      <CopyButton text={value} />
    </Box>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <Typography sx={{ ...obsMonoSx, fontSize: '0.66rem', color: obs.text.dim }}>{children}</Typography>;
}

function OverviewTab({ span }: { span: SpanNode }) {
  const attrs = span.attributes ?? {};
  const kind = span.kind;

  // LLM spans
  if (kind === 'llm') {
    const inputMessages = attrs['llm.input_messages'] as unknown[] | undefined;
    const outputMessages = attrs['llm.output_messages'] as unknown[] | undefined;
    return (
      <Box>
        <AttrStrip attrs={attrs} keys={['gen_ai.request.model', 'gen_ai.usage.input_tokens', 'gen_ai.usage.output_tokens', 'gen_ai.usage.total_tokens', 'gen_ai.response.finish_reason']} />
        {inputMessages && <MessageList title="Input" messages={inputMessages} />}
        {outputMessages && <MessageList title="Output" messages={outputMessages} />}
      </Box>
    );
  }

  // Tool spans
  if (kind === 'tool') {
    return (
      <Box>
        <AttrRow label="tool.name" value={attrs['tool.name']} />
        <AttrRow label="tool.success" value={attrs['tool.success']} />
        <AttrRow label="tool.path" value={attrs['tool.path']} />
        <AttrRow label="tool.elapsed_ms" value={attrs['tool.elapsed_ms']} />
        <Typography sx={{ ...obsMonoSx, fontSize: '0.58rem', color: obs.text.dim, mt: 1, mb: 0.5, display: 'block', textTransform: 'uppercase', letterSpacing: '0.6px' }}>tool.args</Typography>
        <JsonViewer data={attrs['tool.args']} />
        <Typography sx={{ ...obsMonoSx, fontSize: '0.58rem', color: obs.text.dim, mt: 1, mb: 0.5, display: 'block', textTransform: 'uppercase', letterSpacing: '0.6px' }}>tool.output</Typography>
        <JsonViewer data={attrs['tool.output']} />
      </Box>
    );
  }

  // Default: show all attributes
  return <JsonViewer data={attrs} />;
}

function AttrStrip({ attrs, keys }: { attrs: Record<string, unknown>; keys: string[] }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
      {keys.map((k) => attrs[k] != null && (
        <ChipTag key={k} label={`${k.split('.').pop()}: ${attrs[k]}`} />
      ))}
    </Box>
  );
}

function AttrRow({ label, value }: { label: string; value: unknown }) {
  if (value == null) return null;
  return (
    <Box sx={{ display: 'flex', gap: 1, py: 0.25 }}>
      <Typography sx={{ ...obsMonoSx, fontSize: '0.6rem', color: obs.text.dim, minWidth: 110 }}>{label}</Typography>
      <Typography sx={{ ...obsMonoSx, fontSize: '0.64rem', color: obs.text.primary }}>{String(value)}</Typography>
    </Box>
  );
}

function MessageList({ title, messages }: { title: string; messages: unknown[] }) {
  return (
    <Box sx={{ mb: 1.25 }}>
      <Typography sx={{ ...obsMonoSx, fontSize: '0.58rem', color: obs.text.dim, textTransform: 'uppercase', letterSpacing: '0.6px' }}>{title} ({messages.length})</Typography>
      {messages.map((msg, i) => {
        const m = msg as { role?: string; content?: string };
        return (
          <Box key={i} sx={{ my: 0.5, p: 1, bgcolor: obs.bg.void, borderRadius: '5px', border: `1px solid ${obs.border.subtle}` }}>
            <ChipTag label={m.role ?? 'unknown'} color={obs.accent.hud} />
            <Typography sx={{ ...obsMonoSx, fontSize: '0.64rem', color: obs.text.secondary, whiteSpace: 'pre-wrap', wordBreak: 'break-word', mt: 0.5 }}>{m.content ?? ''}</Typography>
          </Box>
        );
      })}
    </Box>
  );
}

function EventsTab({ span }: { span: SpanNode }) {
  const events = span.events ?? [];
  if (events.length === 0) return <EmptyNote>No events.</EmptyNote>;
  return (
    <Box>
      {events.map((ev, i) => (
        <Box key={i} sx={{ mb: 1, p: 1, bgcolor: obs.bg.void, borderRadius: '5px', border: `1px solid ${obs.border.subtle}` }}>
          <Typography sx={{ ...obsMonoSx, fontSize: '0.66rem', fontWeight: 700, color: obs.text.primary }}>{ev.name}</Typography>
          <Typography sx={{ ...obsMonoSx, fontSize: '0.58rem', color: obs.text.dim, display: 'block' }}>{ev.timestamp}</Typography>
          {ev.attributes && <Box sx={{ mt: 0.5 }}><JsonViewer data={ev.attributes} maxHeight={200} /></Box>}
        </Box>
      ))}
    </Box>
  );
}

function LogsTab({ logs }: { logs: ObservabilityLogEntry[] }) {
  if (logs.length === 0) return <EmptyNote>No logs for this span.</EmptyNote>;
  return (
    <Box>
      {logs.map((l, i) => {
        const color = LOG_LEVEL_COLORS[l.level] ?? obs.text.dim;
        return (
          <Box key={i} sx={{ py: 0.6, borderBottom: `1px solid ${obs.border.subtle}` }}>
            <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
              <ChipTag label={l.level} color={color} />
              <Typography sx={{ ...obsMonoSx, fontSize: '0.6rem', color: obs.text.dim }}>{l.scope}</Typography>
            </Box>
            <Typography sx={{ ...obsMonoSx, fontSize: '0.64rem', color: obs.text.primary, display: 'block', whiteSpace: 'pre-wrap', mt: 0.25 }}>{l.message}</Typography>
          </Box>
        );
      })}
    </Box>
  );
}

function ChildrenTab({ children, onSelect }: { children: SpanNode[]; onSelect: (s: SpanNode) => void }) {
  if (children.length === 0) return <EmptyNote>No child spans.</EmptyNote>;
  return (
    <Box>
      {children.map((c) => (
        <Box
          key={c.span_id}
          sx={{ py: 0.6, px: 0.5, cursor: 'pointer', borderRadius: '4px', '&:hover': { bgcolor: obs.bg.hud }, display: 'flex', gap: 0.75, alignItems: 'center' }}
          onClick={() => onSelect(c)}
        >
          <Box sx={{ width: 7, height: 7, borderRadius: '2px', bgcolor: getSpanKindColor(c.kind), flexShrink: 0 }} />
          <Typography sx={{ ...obsMonoSx, fontSize: '0.64rem', color: obs.text.primary, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</Typography>
          <Typography sx={{ ...obsMonoSx, fontSize: '0.6rem', color: obs.text.dim, flexShrink: 0 }}>{c.duration_ms ?? 0}ms</Typography>
          <StatusBadge status={c.status} />
        </Box>
      ))}
    </Box>
  );
}
