/** Metrics dashboard (§11.7) — 7 pre-built dashboards + metric explorer. */
import { useEffect, useState, useCallback, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Grid from '@mui/material/Grid';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, CartesianGrid,
} from 'recharts';
import { getMetricSeries, listMetricNames } from '../api';
import type { MetricSeries } from '@agentx/shared';
import { useObs } from '../context';
import { Panel } from '../components/Panel';
import { StatPanel } from '../components/StatPanel';
import { GaugePanel } from '../components/GaugePanel';
import { ObsPanel, ObsPageHeader } from '../components/ObsPanel';
import { obs, obsMonoSx, obsInputSx } from '../obs-theme';

type DashboardTab = 'agent_overview' | 'llm' | 'tools' | 'app_overview' | 'app_infra' | 'system_health' | 'all';

const DASHBOARDS: { id: DashboardTab; label: string }[] = [
  { id: 'agent_overview', label: 'Agent Overview' },
  { id: 'llm', label: 'LLM Performance' },
  { id: 'tools', label: 'Tool Performance' },
  { id: 'app_overview', label: 'App Overview' },
  { id: 'app_infra', label: 'App Infrastructure' },
  { id: 'system_health', label: 'System Health' },
  { id: 'all', label: 'All Domains' },
];

export function MetricsDashboard() {
  const { domain, timeRange, refreshTick } = useObs();
  const [tab, setTab] = useState<DashboardTab>('agent_overview');
  const [metricNames, setMetricNames] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [seriesCache, setSeriesCache] = useState<Map<string, MetricSeries>>(new Map());

  const loadNames = useCallback(async () => {
    try {
      const res = await listMetricNames(domain === 'both' ? undefined : domain);
      setMetricNames(res.names);
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }, [domain]);

  const loadSeries = useCallback(async (name: string): Promise<MetricSeries | null> => {
    const key = `${name}:${domain}`;
    if (seriesCache.has(key)) return seriesCache.get(key)!;
    try {
      const s = await getMetricSeries({ name, domain: domain === 'both' ? undefined : domain, from: timeRange.from, to: timeRange.to });
      setSeriesCache((prev) => new Map(prev).set(key, s));
      return s;
    } catch {
      return null;
    }
  }, [domain, timeRange, seriesCache]);

  useEffect(() => { loadNames(); }, [loadNames, refreshTick]);
  useEffect(() => { setSeriesCache(new Map()); }, [domain, timeRange.from, timeRange.to, refreshTick]);

  // Dashboard definitions: each tab has a set of panels, each panel fetches a metric.
  const panels = useMemo(() => DASHBOARD_DEFS[tab] ?? [], [tab]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <ObsPageHeader icon={<ShowChartIcon sx={{ fontSize: 18 }} />} title="Metrics" />

      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons={false}>
        {DASHBOARDS.map((d) => (
          <Tab key={d.id} value={d.id} label={d.label} />
        ))}
      </Tabs>

      <MetricExplorer names={metricNames} onExplore={() => {}} />

      {error && <Alert severity="error">{error}</Alert>}

      <KpiGrid />

      <Grid container spacing={1.5}>
        {panels.map((p) => (
          <Grid item xs={p.width ?? 6} key={p.title}>
            <Box sx={{ height: 220 }}>
              <Panel title={p.title}>
                <MetricPanelContent def={p} loadSeries={loadSeries} timeRange={timeRange} />
              </Panel>
            </Box>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}

interface PanelDef {
  title: string;
  metric: string;
  type: 'line' | 'stat' | 'bar' | 'gauge' | 'table';
  width?: 6 | 12;
  unit?: string;
  max?: number;
}

const DASHBOARD_DEFS: Partial<Record<DashboardTab, PanelDef[]>> = {
  agent_overview: [
    { title: 'Turns Total', metric: 'agentx_turns_total', type: 'stat' },
    { title: 'Turn Duration', metric: 'agentx_turn_duration_seconds', type: 'line', unit: 's' },
    { title: 'Error Rate', metric: 'agentx_turn_errors_total', type: 'stat' },
    { title: 'Active Sessions', metric: 'agentx_active_sessions', type: 'gauge', max: 100 },
  ],
  llm: [
    { title: 'Tokens Input/Output', metric: 'agentx_tokens_total', type: 'line' },
    { title: 'Cost Over Time', metric: 'agentx_cost_usd_total', type: 'line', unit: '$' },
    { title: 'Finish Reasons', metric: 'agentx_finish_reasons_total', type: 'bar' },
    { title: 'Latency by Provider', metric: 'agentx_llm_latency_ms', type: 'line', unit: 'ms' },
  ],
  tools: [
    { title: 'Tool Calls by Name', metric: 'agentx_tool_calls_total', type: 'bar' },
    { title: 'Tool Latency p50/p90/p99', metric: 'agentx_tool_latency_ms', type: 'line', unit: 'ms' },
    { title: 'Failed Tool Calls', metric: 'agentx_tool_failures_total', type: 'stat' },
  ],
  app_overview: [
    { title: 'HTTP Requests', metric: 'http_requests_total', type: 'stat' },
    { title: 'HTTP Latency', metric: 'http_request_duration_ms', type: 'line', unit: 'ms' },
    { title: 'Auth Failures', metric: 'auth_failures_total', type: 'stat' },
    { title: 'DB Query Rate', metric: 'db_queries_total', type: 'line' },
  ],
  app_infra: [
    { title: 'Channel Events', metric: 'channel_events_total', type: 'line' },
    { title: 'Automation Runs', metric: 'automation_runs_total', type: 'stat' },
    { title: 'Integration Calls', metric: 'integration_calls_total', type: 'line' },
  ],
  system_health: [
    { title: 'Heap Used', metric: 'nodejs_heap_size_used_bytes', type: 'line', unit: 'B' },
    { title: 'Event Loop Lag', metric: 'nodejs_eventloop_lag_ms', type: 'line', unit: 'ms' },
    { title: 'Exporter Queue', metric: 'agentx_exporter_queue_depth', type: 'gauge', max: 4096 },
    { title: 'Dropped Spans', metric: 'agentx_exporter_dropped_total', type: 'stat' },
  ],
  all: [
    { title: 'Agent Error Rate', metric: 'agentx_turn_errors_total', type: 'stat' },
    { title: 'App Error Rate', metric: 'http_errors_total', type: 'stat' },
    { title: 'Turn Duration + HTTP Latency', metric: 'agentx_turn_duration_seconds', type: 'line' },
  ],
};

const KPI_METRICS = [
  { name: 'agentx_tokens_total', title: 'Token Budget', type: 'stat' as const },
  { name: 'agentx_cost_usd_total', title: 'Cost Budget', type: 'stat' as const, unit: '$' },
  { name: 'agentx_turn_duration_seconds', title: 'Latency', type: 'stat' as const, unit: 's' },
  { name: 'agentx_turn_errors_total', title: 'Error Rate', type: 'stat' as const },
  { name: 'agentx_exporter_queue_depth', title: 'Queue Depth', type: 'gauge' as const, max: 4096 },
  { name: 'agentx_memory_cache_hit_rate', title: 'Cache Hit', type: 'gauge' as const, max: 100, unit: '%', invert: true, zones: { green: 20, amber: 50 } as const },
];

function KpiGrid() {
  const { timeRange, refreshTick } = useObs();
  const [series, setSeries] = useState<Record<string, MetricSeries | null>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(
      KPI_METRICS.map((m) =>
        getMetricSeries({ name: m.name, from: timeRange.from, to: timeRange.to })
          .then((s) => ({ name: m.name, s }))
          .catch(() => ({ name: m.name, s: null as MetricSeries | null }))
      )
    ).then((results) => {
      if (cancelled) return;
      const map: Record<string, MetricSeries | null> = {};
      for (const r of results) map[r.name] = r.s;
      setSeries(map);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [timeRange.from, timeRange.to, refreshTick]);

  return (
    <Grid container spacing={1.5}>
      {KPI_METRICS.map((m) => {
        const s = series[m.name];
        const last = s?.points[s.points.length - 1];
        const value = last?.value ?? 0;
        return (
          <Grid item xs={6} md={4} key={m.name}>
            <Box sx={{ height: 140 }}>
              <ObsPanel>
                <Box sx={{ height: '100%', p: 1 }}>
                  {loading || !s ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                      <CircularProgress size={18} sx={{ color: obs.accent.hud }} />
                    </Box>
                  ) : s.points.length === 0 ? (
                    <Typography sx={{ ...obsMonoSx, fontSize: '0.62rem', color: obs.text.dim }}>No data.</Typography>
                  ) : m.type === 'gauge' ? (
                    <GaugePanel value={m.name === 'agentx_memory_cache_hit_rate' && value <= 1 ? value * 100 : value} max={m.max ?? 100} label={m.title} unit={m.unit} invert={m.invert} zones={m.zones} />
                  ) : (
                    <StatPanel value={value} label={m.title} unit={m.unit} data={s.points} />
                  )}
                </Box>
              </ObsPanel>
            </Box>
          </Grid>
        );
      })}
    </Grid>
  );
}

function MetricPanelContent({
  def,
  loadSeries,
  timeRange,
}: {
  def: PanelDef;
  loadSeries: (name: string) => Promise<MetricSeries | null>;
  timeRange: { from: string; to: string };
}) {
  const [series, setSeries] = useState<MetricSeries | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadSeries(def.metric).then((s) => {
      if (!cancelled) { setSeries(s); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [def.metric, loadSeries, timeRange]);

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center' }}><CircularProgress size={20} sx={{ color: obs.accent.hud }} /></Box>;
  if (!series || series.points.length === 0) {
    return <Typography sx={{ ...obsMonoSx, fontSize: '0.62rem', color: obs.text.dim }}>No data.</Typography>;
  }

  const points = series.points;

  if (def.type === 'stat') {
    const last = points[points.length - 1];
    return <StatPanel value={last?.value ?? 0} label={def.title} unit={def.unit} data={points} />;
  }

  if (def.type === 'gauge') {
    const last = points[points.length - 1];
    return <GaugePanel value={last?.value ?? 0} max={def.max ?? 100} label={def.title} unit={def.unit} />;
  }

  if (def.type === 'bar') {
    // Group by series label value (e.g. tool name, finish reason).
    const byLabel = new Map<string, number>();
    byLabel.set('total', points.reduce((sum, p) => sum + p.value, 0));
    const barData = [...byLabel.entries()].map(([name, value]) => ({ name, value }));
    return (
      <Box sx={{ height: '100%' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={barData}>
            <XAxis dataKey="name" tick={{ fontSize: 9, fill: obs.text.dim }} />
            <YAxis tick={{ fontSize: 10, fill: obs.text.dim }} />
            <Tooltip contentStyle={{ background: obs.bg.panel, border: `1px solid ${obs.border.default}`, fontSize: 11 }} />
            <Bar dataKey="value" fill={obs.accent.hud} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Box>
    );
  }

  // Default: line chart — single series from the MetricSeries.
  const lineData = points.map((p) => ({
    t: new Date(p.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    v: p.value,
  }));
  const seriesLabel = JSON.stringify(series.labels);

  return (
    <Box sx={{ height: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={lineData}>
          <CartesianGrid strokeDasharray="3 3" stroke={obs.border.subtle} />
          <XAxis dataKey="t" tick={{ fontSize: 9, fill: obs.text.dim }} />
          <YAxis tick={{ fontSize: 10, fill: obs.text.dim }} />
          <Tooltip contentStyle={{ background: obs.bg.panel, border: `1px solid ${obs.border.default}`, fontSize: 11 }} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Line type="monotone" dataKey="v" name={seriesLabel} stroke={obs.accent.hud} strokeWidth={1.25} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
}

function MetricExplorer({ names, onExplore }: { names: string[]; onExplore: (name: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <ObsPanel>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <Typography sx={{ ...obsMonoSx, fontSize: '0.6rem', color: obs.text.dim, textTransform: 'uppercase', letterSpacing: '0.8px', flexShrink: 0 }}>
          Explore
        </Typography>
        <Autocomplete
          size="small"
          options={names}
          value={selected}
          onChange={(_, v) => { setSelected(v); if (v) onExplore(v); }}
          renderInput={(params) => <TextField {...params} placeholder="Metric name…" sx={{ width: 260, ...obsInputSx }} />}
          sx={{ flexShrink: 0 }}
        />
      </Box>
    </ObsPanel>
  );
}
