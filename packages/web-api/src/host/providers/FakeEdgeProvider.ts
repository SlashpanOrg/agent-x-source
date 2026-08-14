import type { TunnelProviderCatalogEntry, TunnelProviderCredentials, TunnelStatus } from '@agentx/shared';
import type {
  EdgeCredentialTestResult,
  EdgeStartRequest,
  PublicEdgeProvider,
} from '../PublicEdgeGateway.js';
import { idleTunnelStatus, withState } from '../PublicEdgeGateway.js';

/**
 * Deterministic tunnel provider for tests — no network, no child process.
 */
export class FakeEdgeProvider implements PublicEdgeProvider {
  readonly id = 'fake' as const;
  readonly catalog: TunnelProviderCatalogEntry = {
    id: 'fake',
    name: 'Fake Tunnel',
    tagline: 'Deterministic edge for automated tests',
    setupSteps: ['Used automatically in tests.'],
    credentialFields: [
      { key: 'authToken', label: 'Token', secret: true, required: true },
    ],
    testingOnly: true,
  };

  private status: TunnelStatus = idleTunnelStatus('fake');

  async testCredentials(credentials: TunnelProviderCredentials): Promise<EdgeCredentialTestResult> {
    if (!credentials.authToken?.trim()) {
      return { ok: false, message: 'Token required' };
    }
    return { ok: true, message: 'Fake tunnel credentials ok' };
  }

  async start(input: EdgeStartRequest): Promise<TunnelStatus> {
    const test = await this.testCredentials(input.credentials);
    if (!test.ok) {
      this.status = withState(this.status, 'error', { lastError: test.message ?? 'auth_failed' });
      return this.status;
    }
    this.status = withState(idleTunnelStatus('fake'), 'active', {
      publicUrl: `https://fake-tunnel.example/${input.upstreamPort}`,
      tunnelId: 'fake-tunnel-1',
      region: input.region ?? 'auto',
      protocol: 'https',
      startedAt: new Date().toISOString(),
      verifiedUpstream: true,
      lastError: null,
    });
    return this.status;
  }

  async stop(): Promise<TunnelStatus> {
    this.status = withState(this.status, 'stopped', {
      publicUrl: null,
      tunnelId: null,
      pid: null,
      verifiedUpstream: false,
    });
    return this.status;
  }

  async restart(input: EdgeStartRequest): Promise<TunnelStatus> {
    await this.stop();
    return this.start(input);
  }

  getStatus(): TunnelStatus {
    return this.status;
  }
}
