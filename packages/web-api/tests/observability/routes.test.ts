/**
 * Observability API route tests (§14.3).
 *
 * Tests dev-mode gating, verify/enable/disable flow, and data endpoints
 * using a mock ObservabilityStore + handle.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { observabilityRouter, type ObservabilityApiContext } from '../../src/routes/observability/index.js';
import { clearDevModeTokens } from '../../src/middleware/dev-mode.js';
import type { ObservabilityStore } from '@agentx/engine';

// Mock authManager methods used by the dev-mode middleware.
vi.mock('@agentx/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentx/shared')>();
  return {
    ...actual,
    authManager: {
      ...actual.authManager,
      hasRootUser: vi.fn(() => true),
      getRootUsername: vi.fn(() => 'root'),
      login: vi.fn(async (_user: string, password: string) => {
        if (password === 'correct') return 'fake-token';
        throw new Error('Invalid credentials');
      }),
    },
  };
});

// Mock store with in-memory data.
function makeMockStore(): ObservabilityStore {
  const traces = new Map();
  const logs: unknown[] = [];
  const metrics = new Map();
  return {
    listTraces: vi.fn(async (filters) => {
      let arr = [...traces.values()];
      if (filters.session_id) arr = arr.filter((t) => t.session_id === filters.session_id);
      if (filters.status) arr = arr.filter((t) => t.status === filters.status);
      return arr.slice(0, filters.limit ?? 50);
    }),
    getTrace: vi.fn(async (id) => traces.get(id)),
    insertTrace: vi.fn(async (row) => { traces.set(row.trace_id, row); return true; }),
    getLogs: vi.fn(async () => ({ logs, nextCursor: undefined })),
    getMetricSeries: vi.fn(async (name) => ({ name, labels: {}, points: [] })),
    listMetricNames: vi.fn(async () => [...metrics.keys()]),
    getConfig: vi.fn(async () => ({ retention_days: 30, capture_prompts: true, enabled: true })),
    updateConfig: vi.fn(async (patch) => ({ retention_days: 30, capture_prompts: true, enabled: true, ...patch })),
    purgeAll: vi.fn(async () => {}),
    purgeOlderThan: vi.fn(async () => {}),
    insertLog: vi.fn(async (row) => { logs.push(row); }),
    insertMetricSamples: vi.fn(async (rows) => { for (const r of rows) metrics.set(r.name, true); }),
    getExportBundle: vi.fn(async () => ({ trace: {}, spans: [], logs: [], metrics: [] })),
  } as unknown as ObservabilityStore;
}

function makeMockHandle(store: ObservabilityStore) {
  return {
    store,
    logExporter: { start: vi.fn(), stop: vi.fn(), shutdown: vi.fn() },
    metricsSampler: { start: vi.fn(), stop: vi.fn(), shutdown: vi.fn() },
    retentionPurger: { start: vi.fn(), stop: vi.fn(), runOnce: vi.fn() },
    isEnabled: () => true,
    reloadConfig: vi.fn(),
    stop: vi.fn(),
  };
}

const TEST_TOKEN = 'test-session-token';

describe('Observability API routes', () => {
  let app: express.Express;
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  let store: ObservabilityStore;

  beforeAll(async () => {
    store = makeMockStore();
    const handle = makeMockHandle(store);
    const ctx: ObservabilityApiContext = {
      store,
      handle,
    } as unknown as ObservabilityApiContext;

    app = express();
    app.use(express.json());
    // Auth middleware — sets req.auth = { token } if Authorization header present.
    app.use((req, _res, next) => {
      const auth = req.headers.authorization;
      if (auth === `Bearer ${TEST_TOKEN}`) {
        (req as unknown as { auth: { token: string } }).auth = { token: TEST_TOKEN };
      }
      next();
    });
    app.use('/api/observability', observabilityRouter(ctx));

    server = createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => { await new Promise<void>((r) => server.close(r)); });

  beforeEach(() => {
    vi.clearAllMocks();
    clearDevModeTokens();
  });

  async function fetchObs(path: string, opts: RequestInit = {}) {
    const headers: Record<string, string> = { ...(opts.headers as Record<string, string> || {}) };
    headers['Authorization'] = `Bearer ${TEST_TOKEN}`;
    if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    return fetch(`${baseUrl}/api/observability${path}`, { ...opts, headers });
  }

  async function enableDevMode() {
    await fetchObs('/dev/verify', { method: 'POST', body: JSON.stringify({ password: 'correct' }) });
    await fetchObs('/dev/enable', { method: 'POST' });
  }

  it('dev mode off → data endpoints accessible (200), config endpoints 403', async () => {
    // Data endpoints (traces, logs, metrics, health) are accessible without dev mode.
    const tracesRes = await fetchObs('/traces');
    expect(tracesRes.status).toBe(200);
    // Config endpoints require dev mode.
    const configRes = await fetchObs('/config');
    expect(configRes.status).toBe(403);
  });

  it('/dev/status returns enabled=false initially', async () => {
    const res = await fetchObs('/dev/status');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(false);
  });

  it('/dev/verify with correct password → 200', async () => {
    const res = await fetchObs('/dev/verify', { method: 'POST', body: JSON.stringify({ password: 'correct' }) });
    expect(res.status).toBe(200);
  });

  it('/dev/verify with wrong password → 401', async () => {
    const res = await fetchObs('/dev/verify', { method: 'POST', body: JSON.stringify({ password: 'wrong' }) });
    expect(res.status).toBe(401);
  });

  it('/dev/enable after verify → data endpoints 200', async () => {
    await enableDevMode();
    const res = await fetchObs('/traces');
    expect(res.status).toBe(200);
  });

  it('/dev/disable → data endpoints still accessible (200), config 403', async () => {
    await enableDevMode();
    await fetchObs('/dev/disable', { method: 'POST' });
    // Data endpoints remain accessible after disabling dev mode.
    const tracesRes = await fetchObs('/traces');
    expect(tracesRes.status).toBe(200);
    // Config endpoints require dev mode again.
    const configRes = await fetchObs('/config');
    expect(configRes.status).toBe(403);
  });

  it('GET /traces returns trace list', async () => {
    await enableDevMode();
    await store.insertTrace({ trace_id: 't1', root_span_id: 'r', domain: 'AGENT', kind: 'turn', status: 'ok', started_at: new Date().toISOString(), tool_call_count: 0, cost_usd: 0 });
    const res = await fetchObs('/traces');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.traces)).toBe(true);
    expect(body.traces).toHaveLength(1);
  });

  it('GET /config returns current config', async () => {
    await enableDevMode();
    const res = await fetchObs('/config');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.retention_days).toBe(30);
  });

  it('PUT /config updates config', async () => {
    await enableDevMode();
    const res = await fetchObs('/config', { method: 'PUT', body: JSON.stringify({ retention_days: 7 }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.retention_days).toBe(7);
  });

  it('POST /purge with confirm=true → 200', async () => {
    await enableDevMode();
    const res = await fetchObs('/purge', { method: 'POST', body: JSON.stringify({ confirm: true }) });
    expect(res.status).toBe(200);
    expect(store.purgeAll).toHaveBeenCalled();
  });

  it('POST /purge without confirm → 400', async () => {
    await enableDevMode();
    const res = await fetchObs('/purge', { method: 'POST', body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });

  it('GET /health returns status', async () => {
    await enableDevMode();
    const res = await fetchObs('/health');
    expect(res.status).toBe(200);
  });
});
