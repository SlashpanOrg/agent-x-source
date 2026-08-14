import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { publicEdgeGuard, isPublicEdgePathAllowed } from '../src/host/middleware/public-edge-policy.js';
import { csrfOriginGuard } from '../src/host/middleware/csrf-origin.js';
import { createRateLimiter, resetHostRateLimiters } from '../src/host/middleware/rate-limit.js';
import { redactAddressesForRemote, fetchPublicIp } from '../src/host/discovery.js';
import { recordHostEvent, listHostEvents, clearHostEvents } from '../src/host/audit.js';
import { HostGateway, setHostGateway, PublicEdgeRegistry } from '../src/host/index.js';
import { FakeEdgeProvider } from '../src/host/providers/FakeEdgeProvider.js';
import { metricsRegistry } from '../src/metrics/MetricsRegistry.js';

function makeReq(overrides: Partial<Request> & { headers?: Record<string, unknown> } = {}): Request {
  return {
    headers: {},
    path: '/',
    method: 'GET',
    query: {},
    ip: '203.0.113.5',
    socket: { remoteAddress: '203.0.113.5' } as never,
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response & { statusCode: number; body: unknown; headers: Record<string, string> } {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    getHeader(name: string) {
      return this.headers[name];
    },
  } as unknown as Response & { statusCode: number; body: unknown; headers: Record<string, string> };
  return res;
}

describe('publicEdgeGuard', () => {
  beforeEach(() => {
    setHostGateway(null);
  });
  afterEach(() => {
    setHostGateway(null);
  });

  it('leaves local (non-public-edge) traffic untouched even on denylisted paths', () => {
    const req = makeReq({ path: '/api/observability/traces' });
    const res = makeRes();
    const next = vi.fn();
    publicEdgeGuard(req, res, next as NextFunction);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(0);
  });

  it('denies /api/observability over the public edge with 404', () => {
    const req = makeReq({ path: '/api/observability/traces', headers: { 'x-forwarded-for': '1.2.3.4' } });
    const res = makeRes();
    const next = vi.fn();
    publicEdgeGuard(req, res, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ error: 'not_found' });
  });

  it('denies /metrics over the public edge with 404 and increments the rejection counter', () => {
    const req = makeReq({ path: '/metrics', headers: { 'x-forwarded-for': '1.2.3.4' } });
    const res = makeRes();
    const next = vi.fn();
    publicEdgeGuard(req, res, next as NextFunction);
    expect(res.statusCode).toBe(404);
    expect(metricsRegistry.report()).toContain('host_public_requests_rejected_total');
  });

  it('allows allowlisted paths over the public edge', () => {
    const req = makeReq({ path: '/api/host/status', headers: { 'x-forwarded-for': '1.2.3.4' } });
    const res = makeRes();
    const next = vi.fn();
    publicEdgeGuard(req, res, next as NextFunction);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(0);
  });

  it('does not apply the public-edge allowlist to local traffic while a tunnel is active', async () => {
    const registry = new PublicEdgeRegistry();
    registry.register(new FakeEdgeProvider());
    const gateway = new HostGateway({ bindHost: '127.0.0.1', bindPort: 3333, registry, includeFake: false });
    setHostGateway(gateway);
    gateway.applyConfig({ provider: 'fake', tunnelProviders: { fake: { credentials: { authToken: 'tok' } } } });
    await gateway.startTunnel('fake');

    // Electron / loopback — no forwarding headers
    const localReq = makeReq({ path: '/api/chat/stream', ip: '127.0.0.1' });
    const localRes = makeRes();
    const localNext = vi.fn();
    publicEdgeGuard(localReq, localRes, localNext as NextFunction);
    expect(localNext).toHaveBeenCalled();
    expect(localRes.statusCode).toBe(0);

    // Real tunnel client — forwarding headers present; denylist still enforced
    const edgeReq = makeReq({ path: '/metrics', headers: { 'x-forwarded-for': '203.0.113.9' } });
    const edgeRes = makeRes();
    publicEdgeGuard(edgeReq, edgeRes, vi.fn() as NextFunction);
    expect(edgeRes.statusCode).toBe(404);
  });

  it('adds HSTS only when the request is https (via x-forwarded-proto)', () => {
    const httpsReq = makeReq({ path: '/', headers: { 'x-forwarded-proto': 'https' } });
    const httpsRes = makeRes();
    publicEdgeGuard(httpsReq, httpsRes, vi.fn() as NextFunction);
    expect(httpsRes.headers['Strict-Transport-Security']).toBeTruthy();

    const httpReq = makeReq({ path: '/', headers: { 'x-forwarded-proto': 'http' } });
    const httpRes = makeRes();
    publicEdgeGuard(httpReq, httpRes, vi.fn() as NextFunction);
    expect(httpRes.headers['Strict-Transport-Security']).toBeUndefined();
  });

  it('always sets Referrer-Policy and Permissions-Policy', () => {
    const req = makeReq({ path: '/' });
    const res = makeRes();
    publicEdgeGuard(req, res, vi.fn() as NextFunction);
    expect(res.headers['Referrer-Policy']).toBe('no-referrer');
    expect(res.headers['Permissions-Policy']).toContain('microphone=(self)');
  });
});

describe('isPublicEdgePathAllowed', () => {
  it('denies internals and allows the app surface when the tunnel is up', () => {
    expect(isPublicEdgePathAllowed('/api/observability/traces')).toBe(false);
    expect(isPublicEdgePathAllowed('/metrics')).toBe(false);
    expect(isPublicEdgePathAllowed('/api/jobs')).toBe(false);
    expect(isPublicEdgePathAllowed('/api/host/status')).toBe(true);
    expect(isPublicEdgePathAllowed('/api/chat/stream')).toBe(true);
    expect(isPublicEdgePathAllowed('/api/agent/persona')).toBe(true);
    expect(isPublicEdgePathAllowed('/api/setup/status')).toBe(true);
    expect(isPublicEdgePathAllowed('/api/voice/session')).toBe(true);
    expect(isPublicEdgePathAllowed('/api/telephony/twilio/inbound')).toBe(true);
  });

  it('ignores legacy per-surface exposure flags — denylist only', () => {
    const legacyOff = { web: false, voice: false, telephonyWebhooks: false };
    expect(isPublicEdgePathAllowed('/api/chat/stream', legacyOff)).toBe(true);
    expect(isPublicEdgePathAllowed('/api/voice/session', legacyOff)).toBe(true);
    expect(isPublicEdgePathAllowed('/api/telephony/twilio/inbound', legacyOff)).toBe(true);
    expect(isPublicEdgePathAllowed('/api/observability/traces', legacyOff)).toBe(false);
  });
});

describe('rate limiting', () => {
  afterEach(() => {
    resetHostRateLimiters();
  });

  it('trips after `max` hits within the window and recovers key-by-key', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2, name: 'test_limiter', keyFn: () => 'shared-key' });
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('a')).toBe(false);
    // A different key has its own independent budget.
    expect(limiter.check('b')).toBe(true);
  });

  it('middleware rejects with 429 once the limit trips and increments the metric', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, name: 'test_mw_limiter', keyFn: () => 'k' });
    const req = makeReq();
    const res1 = makeRes();
    const res2 = makeRes();
    const next1 = vi.fn();
    const next2 = vi.fn();

    limiter.middleware(req, res1, next1 as NextFunction);
    expect(next1).toHaveBeenCalled();
    expect(res1.statusCode).toBe(0);

    limiter.middleware(req, res2, next2 as NextFunction);
    expect(next2).not.toHaveBeenCalled();
    expect(res2.statusCode).toBe(429);
    expect(metricsRegistry.report()).toContain('host_rate_limit_rejected_total');
  });

  it('skips limiting when keyFn returns null (e.g. no session for the account tier)', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 0, name: 'acct', keyFn: () => null });
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    limiter.middleware(req, res, next as NextFunction);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(0);
  });
});

describe('csrfOriginGuard', () => {
  const publicEdgeHeaders = { 'x-forwarded-for': '1.2.3.4' };

  it('rejects a cookie-authenticated mutation with a mismatched Origin', () => {
    const req = makeReq({
      method: 'POST',
      path: '/api/host/config',
      headers: {
        ...publicEdgeHeaders,
        cookie: 'agentx_session=tok123',
        host: 'agentx.example.com',
        origin: 'https://evil.example.com',
      },
    });
    const res = makeRes();
    const next = vi.fn();
    csrfOriginGuard(req, res, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('allows a cookie-authenticated mutation with a matching Origin', () => {
    const req = makeReq({
      method: 'POST',
      path: '/api/host/config',
      headers: {
        ...publicEdgeHeaders,
        cookie: 'agentx_session=tok123',
        host: 'agentx.example.com',
        origin: 'https://agentx.example.com',
      },
    });
    const res = makeRes();
    const next = vi.fn();
    csrfOriginGuard(req, res, next as NextFunction);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(0);
  });

  it('does not enforce CSRF when no session cookie is present (bearer-only clients)', () => {
    const req = makeReq({
      method: 'POST',
      path: '/api/host/config',
      headers: { ...publicEdgeHeaders, host: 'agentx.example.com', origin: 'https://evil.example.com' },
    });
    const res = makeRes();
    const next = vi.fn();
    csrfOriginGuard(req, res, next as NextFunction);
    expect(next).toHaveBeenCalled();
  });

  it('exempts telephony webhook paths', () => {
    const req = makeReq({
      method: 'POST',
      path: '/api/telephony/twilio/inbound',
      headers: {
        ...publicEdgeHeaders,
        cookie: 'agentx_session=tok123',
        host: 'agentx.example.com',
        origin: 'https://evil.example.com',
      },
    });
    const res = makeRes();
    const next = vi.fn();
    csrfOriginGuard(req, res, next as NextFunction);
    expect(next).toHaveBeenCalled();
  });

  it('exempts /api/auth/login and /api/auth/setup', () => {
    for (const path of ['/api/auth/login', '/api/auth/setup']) {
      const req = makeReq({
        method: 'POST',
        path,
        headers: {
          ...publicEdgeHeaders,
          cookie: 'agentx_session=tok123',
          host: 'agentx.example.com',
          origin: 'https://evil.example.com',
        },
      });
      const res = makeRes();
      const next = vi.fn();
      csrfOriginGuard(req, res, next as NextFunction);
      expect(next).toHaveBeenCalled();
    }
  });

  it('does not enforce CSRF for non-state-changing methods or non-public-edge requests', () => {
    const getReq = makeReq({ method: 'GET', path: '/api/host/config', headers: { ...publicEdgeHeaders, cookie: 'agentx_session=tok' } });
    const getRes = makeRes();
    csrfOriginGuard(getReq, getRes, vi.fn() as NextFunction);
    expect(getRes.statusCode).toBe(0);

    const localReq = makeReq({ method: 'POST', path: '/api/host/config', headers: { cookie: 'agentx_session=tok' } });
    const localRes = makeRes();
    csrfOriginGuard(localReq, localRes, vi.fn() as NextFunction);
    expect(localRes.statusCode).toBe(0);
  });
});

describe('fake tunnel lifecycle', () => {
  beforeEach(() => {
    clearHostEvents();
  });
  afterEach(() => {
    setHostGateway(null);
  });

  it('starts and stops a fake tunnel and records audit events', async () => {
    const registry = new PublicEdgeRegistry();
    registry.register(new FakeEdgeProvider());
    const gateway = new HostGateway({ bindHost: '127.0.0.1', bindPort: 3333, registry, includeFake: false });
    setHostGateway(gateway);
    gateway.applyConfig({ provider: 'fake', tunnelProviders: { fake: { credentials: { authToken: 'tok' } } } });

    const started = await gateway.startTunnel('fake');
    expect(started.state).toBe('active');
    expect(started.publicUrl).toContain('https://fake-tunnel.example');

    const stopped = await gateway.stopTunnel();
    expect(stopped.state).toBe('stopped');

    const events = listHostEvents(10).map((e) => e.code);
    expect(events).toContain('tunnel_start');
    expect(events).toContain('tunnel_stop');
  });

  it('records an emergency_stop audit event', () => {
    const registry = new PublicEdgeRegistry();
    registry.register(new FakeEdgeProvider());
    const gateway = new HostGateway({ bindHost: '127.0.0.1', bindPort: 3333, registry, includeFake: false });
    setHostGateway(gateway);
    gateway.emergencyStop();
    const events = listHostEvents(10).map((e) => e.code);
    expect(events).toContain('emergency_stop');
    gateway.clearEmergencyStop();
  });
});

describe('host audit ring buffer', () => {
  beforeEach(() => clearHostEvents());

  it('caps at 500 events and returns most-recent-first-slice ordering', () => {
    for (let i = 0; i < 505; i++) {
      recordHostEvent({ category: 'system', code: 'test_event', message: `event ${i}` });
    }
    const events = listHostEvents(1000);
    expect(events.length).toBe(500);
    expect(events.at(-1)?.message).toBe('event 504');
  });

  it('listHostEvents respects the limit', () => {
    for (let i = 0; i < 10; i++) {
      recordHostEvent({ category: 'system', code: 'test_event', message: `e${i}` });
    }
    expect(listHostEvents(3)).toHaveLength(3);
    expect(listHostEvents(3).at(-1)?.message).toBe('e9');
  });
});

describe('discovery: redactAddressesForRemote', () => {
  it('strips interfaceName but preserves other address fields', () => {
    const addresses = [
      { address: '192.168.1.5', family: 'IPv4' as const, scope: 'private' as const, internal: false, interfaceName: 'en0' },
      { address: '::1', family: 'IPv6' as const, scope: 'loopback' as const, internal: true, interfaceName: 'lo0' },
    ];
    const redacted = redactAddressesForRemote(addresses);
    expect(redacted).toHaveLength(2);
    for (const addr of redacted) {
      expect(addr).not.toHaveProperty('interfaceName');
    }
    expect(redacted[0]).toMatchObject({ address: '192.168.1.5', family: 'IPv4', scope: 'private', internal: false });
  });
});

describe('discovery: fetchPublicIp', () => {
  it('returns null when discovery is disabled via env', async () => {
    vi.stubEnv('AGENTX_PUBLIC_IP_DISCOVERY', '0');
    const fetchImpl = vi.fn();
    const ip = await fetchPublicIp(fetchImpl as unknown as typeof fetch);
    expect(ip).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('returns the parsed ip on a successful response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ip: '203.0.113.9' }) });
    const ip = await fetchPublicIp(fetchImpl as unknown as typeof fetch);
    expect(ip).toBe('203.0.113.9');
  });

  it('returns null on network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const ip = await fetchPublicIp(fetchImpl as unknown as typeof fetch);
    expect(ip).toBeNull();
  });
});

describe('host startup fail-closed', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'agentx-host-test-'));
    vi.stubEnv('AGENTX_DATA_DIR', dataDir);
    setHostGateway(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    setHostGateway(null);
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('forces publicAccess off on first startup when no clean-shutdown marker exists', async () => {
    vi.resetModules();
    const { HostGateway: HG, setHostGateway: setHG } = await import('../src/host/HostGateway.js');
    const { applyHostConfig, __resetFailClosedCheckForTests } = await import('../src/host/apply-host-config.js');
    __resetFailClosedCheckForTests();

    const gateway = new HG({ bindHost: '127.0.0.1', bindPort: 3333, includeFake: true });
    setHG(gateway);

    await applyHostConfig({ host: { publicAccess: true } } as Parameters<typeof applyHostConfig>[0]);
    expect(gateway.getConfig().publicAccess).toBe(false);
    setHG(null);
  });

  it('honors publicAccess=true after a clean shutdown marker was written', async () => {
    vi.resetModules();
    const { HostGateway: HG, setHostGateway: setHG } = await import('../src/host/HostGateway.js');
    const { applyHostConfig, writeHostCleanShutdownMarker, __resetFailClosedCheckForTests } = await import(
      '../src/host/apply-host-config.js'
    );
    writeHostCleanShutdownMarker();
    __resetFailClosedCheckForTests();

    const gateway = new HG({ bindHost: '127.0.0.1', bindPort: 3333, includeFake: true });
    setHG(gateway);

    await applyHostConfig({ host: { publicAccess: true } } as Parameters<typeof applyHostConfig>[0]);
    expect(gateway.getConfig().publicAccess).toBe(true);
    setHG(null);
  });
});
