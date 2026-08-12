import type {
  HostConfig,
  HostStatusSnapshot,
  SecurityPosture,
  SecurityPostureCheck,
  TunnelProviderCredentials,
  TunnelStatus,
} from '@agentx/shared';
import { defaultHostConfig, getLogger, mergeHostConfig } from '@agentx/shared';
import { authManager } from '@agentx/shared';
import { recordHostEvent } from './audit.js';
import { buildNetworkSnapshot, deriveExposureState, fetchPublicIp } from './discovery.js';
import {
  getPublicEdgeRegistry,
  idleTunnelStatus,
  type EdgeStartRequest,
  type PublicEdgeRegistry,
} from './PublicEdgeGateway.js';
import { FakeEdgeProvider } from './providers/FakeEdgeProvider.js';
import { NgrokEdgeProvider } from './providers/NgrokEdgeProvider.js';

export interface HostGatewayOptions {
  bindHost: string;
  bindPort: number;
  registry?: PublicEdgeRegistry;
  includeFake?: boolean;
}

/**
 * Lifecycle manager for public edge tunnels.
 * Single owner — prevents conflicting tunnel sessions.
 */
export class HostGateway {
  private config: HostConfig = defaultHostConfig();
  private emergencyDisabled = false;
  private readonly bindHost: string;
  private readonly bindPort: number;
  private readonly registry: PublicEdgeRegistry;
  private activeProviderId: string | null = null;
  private cachedPublicIp: string | null = null;
  private publicIpFetchedAt = 0;
  private publicIpInFlight = false;
  private static readonly PUBLIC_IP_TTL_MS = 5 * 60_000;
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectInFlight = false;

  constructor(options: HostGatewayOptions) {
    this.bindHost = options.bindHost;
    this.bindPort = options.bindPort;
    this.registry = options.registry ?? getPublicEdgeRegistry();
    this.ensureBuiltinProviders(options.includeFake ?? process.env['NODE_ENV'] === 'test');
    this.startReconnectWatch();
  }

  /** If public access + autostart are on and the tunnel dropped, try to bring it back. */
  private startReconnectWatch(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setInterval(() => {
      if (this.reconnectInFlight || this.emergencyDisabled) return;
      if (!this.config.publicAccess || !this.config.tunnel?.autostart || !this.config.provider) return;
      const state = this.getTunnelStatus().state;
      if (state === 'active' || state === 'starting' || state === 'authenticating' || state === 'preparing') {
        return;
      }
      this.reconnectInFlight = true;
      void this.startTunnel(this.config.provider)
        .catch((err) => {
          getLogger().warn('HOST_TUNNEL_RECONNECT_FAILED', 'Automatic tunnel reconnect failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          this.reconnectInFlight = false;
        });
    }, 15_000);
    // Don't keep the process alive solely for this timer in tests/CLI.
    if (typeof this.reconnectTimer === 'object' && 'unref' in this.reconnectTimer) {
      this.reconnectTimer.unref();
    }
  }

  private ensureBuiltinProviders(includeFake: boolean): void {
    if (!this.registry.get('ngrok')) {
      this.registry.register(new NgrokEdgeProvider());
    }
    if (includeFake && !this.registry.get('fake')) {
      this.registry.register(new FakeEdgeProvider());
    }
  }

  getRegistry(): PublicEdgeRegistry {
    return this.registry;
  }

  applyConfig(config: HostConfig | null | undefined): void {
    this.config = mergeHostConfig(this.config, config);
  }

  getConfig(): HostConfig {
    return this.config;
  }

  getTunnelCredentials(providerId: string): TunnelProviderCredentials {
    return this.config.tunnelProviders?.[providerId]?.credentials ?? {};
  }

  async testTunnelCredentials(providerId: string) {
    const provider = this.registry.require(providerId);
    return provider.testCredentials(this.getTunnelCredentials(providerId));
  }

  private buildStartRequest(providerId: string): EdgeStartRequest {
    return {
      credentials: this.getTunnelCredentials(providerId),
      upstreamHost: this.bindHost === '0.0.0.0' ? '127.0.0.1' : this.bindHost,
      upstreamPort: this.bindPort,
      region: this.config.tunnel?.region,
    };
  }

  async startTunnel(providerId?: string): Promise<TunnelStatus> {
    if (this.emergencyDisabled) {
      throw new Error('Public access is emergency-disabled');
    }
    const id = providerId ?? this.config.provider;
    if (!id) throw new Error('No tunnel provider selected');
    if (this.activeProviderId && this.activeProviderId !== id) {
      throw new Error(`Another tunnel provider is active (${this.activeProviderId}). Stop it first.`);
    }
    const provider = this.registry.require(id);
    this.activeProviderId = id;
    this.config = {
      ...this.config,
      publicAccess: true,
      provider: id,
      tunnel: { ...this.config.tunnel, autostart: true },
    };
    try {
      const status = await provider.start(this.buildStartRequest(id));
      getLogger().info('HOST_TUNNEL_START', 'Tunnel start requested', { providerId: id, state: status.state });
      if (status.state === 'error') {
        recordHostEvent({
          category: 'tunnel',
          code: 'tunnel_start_error',
          message: status.lastError ?? 'Tunnel failed to start',
          metadata: { providerId: id },
        });
      } else {
        recordHostEvent({
          category: 'tunnel',
          code: 'tunnel_start',
          message: `Tunnel started via ${id}`,
          metadata: { providerId: id, state: status.state, publicUrl: status.publicUrl ?? undefined },
        });
      }
      return status;
    } catch (err) {
      recordHostEvent({
        category: 'tunnel',
        code: 'tunnel_start_error',
        message: err instanceof Error ? err.message : String(err),
        metadata: { providerId: id },
      });
      throw err;
    }
  }

  async stopTunnel(options?: { clearAutostart?: boolean }): Promise<TunnelStatus> {
    const id = this.activeProviderId ?? this.config.provider;
    if (!id) return idleTunnelStatus(null);
    const provider = this.registry.get(id);
    const status = provider ? await provider.stop() : idleTunnelStatus(id);
    this.activeProviderId = null;
    this.config = {
      ...this.config,
      publicAccess: false,
      tunnel: {
        ...this.config.tunnel,
        autostart: options?.clearAutostart === false ? this.config.tunnel?.autostart : false,
      },
    };
    getLogger().info('HOST_TUNNEL_STOP', 'Tunnel stop requested', { providerId: id, state: status.state });
    recordHostEvent({
      category: 'tunnel',
      code: 'tunnel_stop',
      message: `Tunnel stopped (${id})`,
      metadata: { providerId: id },
    });
    return status;
  }

  async revokeTunnelCredentials(providerId: string): Promise<{ tunnel: TunnelStatus }> {
    const tunnel = await this.stopTunnel({ clearAutostart: true });
    this.config = {
      ...this.config,
      provider: this.config.provider === providerId ? null : this.config.provider,
      tunnelProviders: {
        ...this.config.tunnelProviders,
        [providerId]: {
          ...this.config.tunnelProviders?.[providerId],
          credentials: {
            authToken: '',
            authTokenConfigured: false,
          },
        },
      },
    };
    recordHostEvent({
      category: 'tunnel',
      code: 'tunnel_credentials_revoked',
      message: `Tunnel credentials revoked for ${providerId}`,
      metadata: { providerId },
    });
    return { tunnel };
  }

  async restartTunnel(): Promise<TunnelStatus> {
    const id = this.activeProviderId ?? this.config.provider;
    if (!id) throw new Error('No tunnel provider selected');
    const provider = this.registry.require(id);
    return provider.restart(this.buildStartRequest(id));
  }

  emergencyStop(): { tunnel: TunnelStatus } {
    this.emergencyDisabled = true;
    const tunnel = this.activeProviderId
      ? (this.registry.get(this.activeProviderId)?.getStatus() ?? idleTunnelStatus(this.activeProviderId))
      : idleTunnelStatus(null);
    void this.stopTunnel().catch((err) => {
      getLogger().error('HOST_EMERGENCY_STOP_TUNNEL_FAILED', err);
    });
    // End active VOIP sessions (inbound/outbound) — fail closed with public access.
    void import('@agentx/engine')
      .then(async ({ getTelephonyDialService }) => {
        await getTelephonyDialService().emergencyEndAll('emergency_stop');
      })
      .catch((err) => {
        getLogger().error('HOST_EMERGENCY_STOP_CALLS_FAILED', err);
      });
    try {
      // Lazy metric import — HostGateway must not hard-fail if metrics unavailable.
      void import('../metrics/MetricsRegistry.js').then(({ metricsRegistry }) => {
        metricsRegistry.incrementCounter('host_tunnel_stops_total', { reason: 'emergency' });
      });
    } catch {
      /* ignore */
    }
    getLogger().warn('HOST_EMERGENCY_STOP', 'Emergency public-access shutdown', {});
    recordHostEvent({
      category: 'security',
      code: 'emergency_stop',
      message: 'Emergency public-access shutdown triggered',
    });
    return { tunnel };
  }

  clearEmergencyStop(): void {
    this.emergencyDisabled = false;
  }

  getTunnelStatus(): TunnelStatus {
    const id = this.activeProviderId ?? this.config.provider ?? null;
    if (!id) return idleTunnelStatus(null);
    return this.registry.get(id)?.getStatus() ?? idleTunnelStatus(id);
  }

  buildSecurityPosture(): SecurityPosture {
    const checks: SecurityPostureCheck[] = [];
    const hasRoot = authManager.hasRootUser();
    checks.push({
      id: 'root_auth',
      label: 'Root authentication configured',
      pass: hasRoot,
      severity: 'critical',
      remediation: hasRoot ? undefined : 'Complete setup and create a root password.',
    });
    checks.push({
      id: 'public_default_off',
      label: 'Public access disabled by default',
      pass: !this.config.publicAccess || this.getTunnelStatus().state === 'active',
      severity: 'warn',
      remediation: 'Only enable public access when you need it.',
    });
    checks.push({
      id: 'voice_exposure_default_off',
      label: 'Voice exposure off until enabled',
      pass: !this.config.exposure?.voice,
      severity: 'info',
    });
    checks.push({
      id: 'telephony_webhooks_default_off',
      label: 'Telephony webhooks off until configured',
      pass: !this.config.exposure?.telephonyWebhooks,
      severity: 'info',
    });
    const tunnelCreds = this.config.provider
      ? this.getTunnelCredentials(this.config.provider)
      : {};
    const hasTunnelSecret = Boolean(tunnelCreds.authToken?.trim());
    checks.push({
      id: 'tunnel_credentials',
      label: 'Tunnel credentials protected',
      pass: !this.config.provider || hasTunnelSecret || Boolean(tunnelCreds.authTokenConfigured),
      severity: 'warn',
      remediation: 'Add tunnel provider credentials in Host → Public Edge.',
    });
    const telephony = this.config.telephony;
    const activeTel = telephony?.activeProviderId;
    const telCreds = activeTel ? telephony?.providers?.[activeTel]?.credentials : undefined;
    const telSecretOk =
      !telephony?.inboundEnabled ||
      Boolean(telCreds?.authToken?.trim() || telCreds?.authTokenConfigured || telCreds?.apiKeyConfigured);
    checks.push({
      id: 'telephony_signature',
      label: 'Telephony signature verification configured',
      pass: telSecretOk,
      severity: 'critical',
      remediation: 'Add VOIP provider credentials before enabling inbound calls.',
    });
    checks.push({
      id: 'emergency_available',
      label: 'Emergency shutdown available',
      pass: true,
      severity: 'info',
    });
    checks.push({
      id: 'loopback_bind',
      label: 'HTTP server bound to loopback by default',
      pass: this.bindHost === '127.0.0.1' || this.bindHost === '::1' || this.bindHost === 'localhost',
      severity: 'warn',
      remediation: 'Prefer AGENTX_HOST=127.0.0.1 and use a tunnel for public access.',
    });

    const passCount = checks.filter((c) => c.pass).length;
    const failCount = checks.length - passCount;
    const criticalFail = checks.some((c) => !c.pass && c.severity === 'critical');
    return {
      checks,
      passCount,
      failCount,
      readyForPublicAccess: !criticalFail && hasRoot,
    };
  }

  /**
   * Kick off a background public-IP lookup (best-effort, cached with a TTL).
   * Never blocks `getStatus()` — the first call after startup will report
   * `publicIp: null` until the lookup resolves, then subsequent calls report
   * the cached value with `publicIpConfidence: 'unverified'`.
   */
  private maybeRefreshPublicIp(): void {
    if (process.env['AGENTX_PUBLIC_IP_DISCOVERY'] === '0') return;
    // Avoid real network calls during the test suite unless explicitly opted in.
    if (process.env['NODE_ENV'] === 'test' && process.env['AGENTX_PUBLIC_IP_DISCOVERY'] !== '1') return;
    if (this.publicIpInFlight) return;
    const now = Date.now();
    if (this.cachedPublicIp && now - this.publicIpFetchedAt < HostGateway.PUBLIC_IP_TTL_MS) return;
    this.publicIpInFlight = true;
    void fetchPublicIp()
      .then((ip) => {
        this.cachedPublicIp = ip;
        this.publicIpFetchedAt = Date.now();
      })
      .catch(() => { /* best-effort — keep previous cached value */ })
      .finally(() => {
        this.publicIpInFlight = false;
      });
  }

  getStatus(): HostStatusSnapshot {
    this.maybeRefreshPublicIp();
    const network = buildNetworkSnapshot({
      bindHost: this.bindHost,
      bindPort: this.bindPort,
      publicIp: this.cachedPublicIp,
    });
    const tunnel = this.getTunnelStatus();
    const exposureState = deriveExposureState({
      publicAccess: Boolean(this.config.publicAccess),
      tunnel,
      network,
      emergencyDisabled: this.emergencyDisabled,
    });
    return {
      exposureState,
      network,
      tunnel,
      security: this.buildSecurityPosture(),
      config: redactHostConfigForSnapshot(this.config),
      activeRemoteSessions: 0,
      updatedAt: new Date().toISOString(),
    };
  }
}

/** Snapshot config for API — strip secret material. */
export function redactHostConfigForSnapshot(config: HostConfig): HostConfig {
  const tunnelProviders: HostConfig['tunnelProviders'] = {};
  for (const [id, cfg] of Object.entries(config.tunnelProviders ?? {})) {
    const creds = cfg.credentials ?? {};
    tunnelProviders[id] = {
      ...cfg,
      credentials: {
        accountId: creds.accountId,
        extras: creds.extras,
        authTokenConfigured: Boolean(creds.authToken?.trim() || creds.authTokenConfigured),
        authToken: undefined,
      },
    };
  }
  const providers: NonNullable<HostConfig['telephony']>['providers'] = {};
  for (const [id, cfg] of Object.entries(config.telephony?.providers ?? {})) {
    const creds = cfg.credentials ?? {};
    providers[id] = {
      ...cfg,
      credentials: {
        accountId: creds.accountId,
        extras: creds.extras,
        authTokenConfigured: Boolean(creds.authToken?.trim() || creds.authTokenConfigured),
        apiKeyConfigured: Boolean(creds.apiKey?.trim() || creds.apiKeyConfigured),
        apiSecretConfigured: Boolean(creds.apiSecret?.trim() || creds.apiSecretConfigured),
        authToken: undefined,
        apiKey: undefined,
        apiSecret: undefined,
      },
    };
  }
  return {
    ...config,
    tunnelProviders,
    telephony: config.telephony
      ? { ...config.telephony, providers }
      : config.telephony,
  };
}

let hostGatewaySingleton: HostGateway | null = null;

export function getHostGateway(): HostGateway {
  if (!hostGatewaySingleton) {
    throw new Error('HostGateway not initialized');
  }
  return hostGatewaySingleton;
}

export function tryGetHostGateway(): HostGateway | null {
  return hostGatewaySingleton;
}

export function initHostGateway(options: HostGatewayOptions): HostGateway {
  hostGatewaySingleton = new HostGateway(options);
  return hostGatewaySingleton;
}

export function setHostGateway(gateway: HostGateway | null): void {
  hostGatewaySingleton = gateway;
}
