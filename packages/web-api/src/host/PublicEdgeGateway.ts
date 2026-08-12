import type {
  TunnelLifecycleState,
  TunnelProviderCatalogEntry,
  TunnelProviderCredentials,
  TunnelProviderId,
  TunnelStatus,
} from '@agentx/shared';

export interface EdgeStartRequest {
  credentials: TunnelProviderCredentials;
  upstreamHost: string;
  upstreamPort: number;
  region?: string;
}

export interface EdgeCredentialTestResult {
  ok: boolean;
  message?: string;
}

/**
 * Provider-neutral public edge (tunnel) adapter.
 * Register via PublicEdgeRegistry — UI never hard-codes ngrok behavior.
 */
export interface PublicEdgeProvider {
  readonly id: TunnelProviderId;
  readonly catalog: TunnelProviderCatalogEntry;
  testCredentials(credentials: TunnelProviderCredentials): Promise<EdgeCredentialTestResult>;
  start(input: EdgeStartRequest): Promise<TunnelStatus>;
  stop(): Promise<TunnelStatus>;
  restart(input: EdgeStartRequest): Promise<TunnelStatus>;
  getStatus(): TunnelStatus;
}

export class PublicEdgeRegistry {
  private readonly providers = new Map<string, PublicEdgeProvider>();

  register(provider: PublicEdgeProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: TunnelProviderId): PublicEdgeProvider | undefined {
    return this.providers.get(id);
  }

  require(id: TunnelProviderId): PublicEdgeProvider {
    const p = this.get(id);
    if (!p) throw new Error(`Tunnel provider not registered: ${id}`);
    return p;
  }

  list(): PublicEdgeProvider[] {
    return Array.from(this.providers.values());
  }

  listCatalog(options: { includeTesting?: boolean } = {}): TunnelProviderCatalogEntry[] {
    return this.list()
      .map((p) => p.catalog)
      .filter((c) => options.includeTesting || !c.testingOnly);
  }

  clear(): void {
    this.providers.clear();
  }
}

export function idleTunnelStatus(providerId: TunnelProviderId | null = null): TunnelStatus {
  return {
    providerId,
    state: 'disabled',
    publicUrl: null,
    tunnelId: null,
    region: null,
    protocol: null,
    pid: null,
    startedAt: null,
    lastError: null,
    verifiedUpstream: false,
  };
}

export function withState(status: TunnelStatus, state: TunnelLifecycleState, patch?: Partial<TunnelStatus>): TunnelStatus {
  return { ...status, state, ...patch };
}

let edgeRegistrySingleton: PublicEdgeRegistry | null = null;

export function getPublicEdgeRegistry(): PublicEdgeRegistry {
  if (!edgeRegistrySingleton) edgeRegistrySingleton = new PublicEdgeRegistry();
  return edgeRegistrySingleton;
}

export function setPublicEdgeRegistry(registry: PublicEdgeRegistry | null): void {
  edgeRegistrySingleton = registry;
}
