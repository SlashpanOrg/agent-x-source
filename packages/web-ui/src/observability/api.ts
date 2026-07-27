/**
 * Observability API client (§11.3).
 *
 * Fetch wrappers for all `/api/observability/*` endpoints. Reuses the auth
 * token from the main app's `setAuthToken` (the observability window shares
 * the same origin/auth — the token is in sessionStorage).
 */
import type {
  ObservabilityConfig,
  ObservabilityLogEntry,
  MetricSeries,
  SpanNode,
  TraceDetail,
  TraceSummary,
  TraceExportBundle,
  CostRollupRow,
  AlertRow,
} from '@agentx/shared';
import { AGENTX_AUTH_TOKEN_KEY } from '../utils/client-storage';

const BASE = '/api/observability';

function getAuthToken(): string | null {
  try {
    return sessionStorage.getItem(AGENTX_AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

async function fetchObs<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ObsApiError(res.status, body['error'] ?? 'unknown', body['message'] ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export class ObsApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'ObsApiError';
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface ListTracesResponse { traces: TraceSummary[]; nextCursor?: string }
export interface ListLogsResponse { logs: ObservabilityLogEntry[]; nextCursor?: string }
export interface ListMetricNamesResponse { names: string[] }
export interface DevStatusResponse { enabled: boolean; verified: boolean }
export interface DevVerifyResponse { verified: boolean }
export interface DevEnableResponse { enabled: boolean }
export interface HealthResponse {
  enabled: boolean;
  exporterQueueDepth: number;
  exporterDroppedCount: number;
  lastFlushAt?: string;
  pgLatencyMs?: number;
}
export interface PurgeResponse { purged: boolean }

// ── Traces ────────────────────────────────────────────────────────────────────
export function listTraces(params: {
  domain?: string; sessionId?: string; status?: string; kind?: string;
  from?: string; to?: string; q?: string; limit?: number; cursor?: string;
} = {}): Promise<ListTracesResponse> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') qs.set(k, String(v));
  }
  const q = qs.toString();
  return fetchObs(`/traces${q ? `?${q}` : ''}`);
}

export function getTrace(traceId: string): Promise<TraceDetail> {
  return fetchObs(`/traces/${encodeURIComponent(traceId)}`);
}

export function getTraceSpans(traceId: string): Promise<{ spans: SpanNode[] }> {
  return fetchObs(`/traces/${encodeURIComponent(traceId)}/spans`);
}

export function getTraceLogs(traceId: string, params: { limit?: number; cursor?: string } = {}): Promise<ListLogsResponse> {
  const qs = new URLSearchParams();
  if (params.limit != null) qs.set('limit', String(params.limit));
  if (params.cursor) qs.set('cursor', params.cursor);
  const q = qs.toString();
  return fetchObs(`/traces/${encodeURIComponent(traceId)}/logs${q ? `?${q}` : ''}`);
}

export function getSessionTraces(sessionId: string): Promise<ListTracesResponse> {
  return fetchObs(`/sessions/${encodeURIComponent(sessionId)}/traces`);
}

// ── Logs ──────────────────────────────────────────────────────────────────────
export function listLogs(params: {
  domain?: string; sessionId?: string; traceId?: string; level?: string;
  scope?: string; from?: string; to?: string; q?: string; limit?: number; cursor?: string;
} = {}): Promise<ListLogsResponse> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') qs.set(k, String(v));
  }
  const q = qs.toString();
  return fetchObs(`/logs${q ? `?${q}` : ''}`);
}

// ── Metrics ───────────────────────────────────────────────────────────────────
export function getMetricSeries(params: {
  name: string; domain?: string; from?: string; to?: string; step?: string;
}): Promise<MetricSeries> {
  const qs = new URLSearchParams({ name: params.name });
  if (params.domain) qs.set('domain', params.domain);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.step) qs.set('step', params.step);
  return fetchObs(`/metrics?${qs.toString()}`);
}

export function listMetricNames(domain?: string): Promise<ListMetricNamesResponse> {
  const qs = domain ? `?domain=${domain}` : '';
  return fetchObs(`/metrics/names${qs}`);
}

// ── Config ────────────────────────────────────────────────────────────────────
export function getConfig(): Promise<ObservabilityConfig> {
  return fetchObs('/config');
}

export function updateConfig(patch: Partial<ObservabilityConfig>): Promise<ObservabilityConfig> {
  return fetchObs('/config', { method: 'PUT', body: JSON.stringify(patch) });
}

export function purgeAll(): Promise<PurgeResponse> {
  return fetchObs('/purge', { method: 'POST', body: JSON.stringify({ confirm: true }) });
}

// ── Dev mode ──────────────────────────────────────────────────────────────────
export function getDevStatus(): Promise<DevStatusResponse> {
  return fetchObs('/dev/status');
}

export function verifyDev(password: string): Promise<DevVerifyResponse> {
  return fetchObs('/dev/verify', { method: 'POST', body: JSON.stringify({ password }) });
}

export function enableDev(): Promise<DevEnableResponse> {
  return fetchObs('/dev/enable', { method: 'POST' });
}

export function disableDev(): Promise<DevEnableResponse> {
  return fetchObs('/dev/disable', { method: 'POST' });
}

// ── Health ────────────────────────────────────────────────────────────────────
export function getHealth(): Promise<HealthResponse> {
  return fetchObs('/health');
}

// ── Alerts (v1.1+) ────────────────────────────────────────────────────────────
export function listAlerts(resolved = false): Promise<{ alerts: AlertRow[] }> {
  return fetchObs(`/alerts?resolved=${resolved}`);
}

export function resolveAlert(id: number): Promise<{ resolved: boolean }> {
  return fetchObs(`/alerts/${id}/resolve`, { method: 'POST' });
}

// ── Cost analytics (v1.1+) ────────────────────────────────────────────────────
export function getCostRollup(days = 30): Promise<{ rows: CostRollupRow[] }> {
  return fetchObs(`/cost/daily?days=${days}`);
}

// ── Export ────────────────────────────────────────────────────────────────────
export async function exportTrace(traceId: string, format: 'json' | 'markdown'): Promise<string> {
  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/traces/${encodeURIComponent(traceId)}/export?format=${format}`, { headers });
  if (!res.ok) throw new ObsApiError(res.status, 'export-failed', res.statusText);
  return res.text();
}

export async function exportTracePreview(traceId: string, format: 'json' | 'markdown'): Promise<string> {
  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/traces/${encodeURIComponent(traceId)}/export/preview?format=${format}`, { headers });
  if (!res.ok) throw new ObsApiError(res.status, 'export-failed', res.statusText);
  return res.text();
}

export async function getTraceExportBundle(traceId: string): Promise<TraceExportBundle> {
  const text = await exportTracePreview(traceId, 'json');
  return JSON.parse(text) as TraceExportBundle;
}
