import { Router, type Request, type Response } from 'express';
import { getLogger, mergeHostConfig, type HostConfig } from '@agentx/shared';
import { listHostEvents } from './audit.js';
import { buildDiagnosticBundle } from './diagnostics.js';
import { redactAddressesForRemote } from './discovery.js';
import { getHostGateway, redactHostConfigForSnapshot } from './HostGateway.js';
import { isPublicEdgePathAllowed } from './middleware/public-edge-policy.js';

export function createHostRouter(): Router {
  const router = Router();

  router.get('/host/status', (req: Request, res: Response) => {
    try {
      const status = getHostGateway().getStatus();
      // Full interface detail (interfaceName) is only included when explicitly
      // requested via ?detail=1 — the route already requires authentication,
      // but redaction-by-default keeps interface topology out of routine
      // status polling (dashboards, health widgets) and public-edge responses.
      const wantsDetail = req.query['detail'] === '1';
      const network = wantsDetail
        ? status.network
        : { ...status.network, addresses: redactAddressesForRemote(status.network.addresses) };
      res.json({ ...status, network });
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : 'host_unavailable' });
    }
  });

  router.get('/host/events', (req: Request, res: Response) => {
    const limit = Number(req.query['limit'] ?? 100);
    res.json({ events: listHostEvents(Number.isFinite(limit) ? limit : 100) });
  });

  router.get('/host/diagnostics', (_req, res) => {
    try {
      res.json(buildDiagnosticBundle());
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : 'host_unavailable' });
    }
  });

  router.get('/host/security-posture', (_req, res) => {
    try {
      res.json(getHostGateway().buildSecurityPosture());
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : 'host_unavailable' });
    }
  });

  router.get('/host/providers', (_req, res) => {
    try {
      const gateway = getHostGateway();
      res.json({
        tunnel: gateway.getRegistry().listCatalog({ includeTesting: process.env['NODE_ENV'] === 'test' }),
      });
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : 'host_unavailable' });
    }
  });

  router.get('/host/tunnel/status', (_req, res) => {
    try {
      res.json(getHostGateway().getTunnelStatus());
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : 'host_unavailable' });
    }
  });

  router.post('/host/tunnel/credentials/test', async (req, res) => {
    try {
      const providerId = String(req.body?.providerId ?? getHostGateway().getConfig().provider ?? '');
      if (!providerId) {
        res.status(400).json({ error: 'provider_required' });
        return;
      }
      // Allow one-shot credential override for test without persisting.
      const gateway = getHostGateway();
      if (req.body?.credentials && typeof req.body.credentials === 'object') {
        const existing = gateway.getConfig();
        gateway.applyConfig({
          tunnelProviders: {
            ...existing.tunnelProviders,
            [providerId]: {
              ...existing.tunnelProviders?.[providerId],
              credentials: {
                ...existing.tunnelProviders?.[providerId]?.credentials,
                ...req.body.credentials,
              },
            },
          },
        });
      }
      const result = await gateway.testTunnelCredentials(providerId);
      res.json(result);
    } catch (err) {
      res.status(400).json({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/host/tunnel/credentials/revoke', async (req, res) => {
    try {
      const providerId = String(req.body?.providerId ?? getHostGateway().getConfig().provider ?? 'ngrok');
      const result = await getHostGateway().revokeTunnelCredentials(providerId);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/host/tunnel/start', async (req, res) => {
    try {
      const providerId = req.body?.providerId ? String(req.body.providerId) : undefined;
      const gateway = getHostGateway();
      const id = providerId ?? gateway.getConfig().provider;
      // Allow one-shot credential override (same pattern as credentials/test) so Enable
      // works even if the last save only had authTokenConfigured without the secret.
      if (id && req.body?.credentials && typeof req.body.credentials === 'object') {
        const existing = gateway.getConfig();
        gateway.applyConfig({
          tunnelProviders: {
            ...existing.tunnelProviders,
            [id]: {
              ...existing.tunnelProviders?.[id],
              credentials: {
                ...existing.tunnelProviders?.[id]?.credentials,
                ...req.body.credentials,
              },
            },
          },
        });
      }
      const status = await gateway.startTunnel(providerId);
      res.json(status);
    } catch (err) {
      getLogger().error('HOST_TUNNEL_START_FAILED', err);
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/host/tunnel/stop', async (_req, res) => {
    try {
      const status = await getHostGateway().stopTunnel();
      res.json(status);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/host/tunnel/restart', async (_req, res) => {
    try {
      const status = await getHostGateway().restartTunnel();
      res.json(status);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/host/emergency-stop', (_req, res) => {
    try {
      const result = getHostGateway().emergencyStop();
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/host/config', (_req, res) => {
    try {
      res.json(redactHostConfigForSnapshot(getHostGateway().getConfig()));
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : 'host_unavailable' });
    }
  });

  router.patch('/host/config', (req, res) => {
    try {
      const gateway = getHostGateway();
      const incoming = (req.body ?? {}) as HostConfig;
      const merged = mergeHostConfigPreservingSecrets(gateway.getConfig(), incoming);
      gateway.applyConfig(merged);
      // Persist via engine config is handled by caller / applyHostConfigFromEngine.
      res.json(redactHostConfigForSnapshot(gateway.getConfig()));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/host/edge-allowlist/check', (req: Request, res: Response) => {
    const path = String(req.query['path'] ?? '/');
    res.json({ path, allowed: isPublicEdgePathAllowed(path) });
  });

  return router;
}

/**
 * Client payloads are redacted (`authTokenConfigured: false` when empty).
 * A new secret must win over that stale flag — otherwise Verify + autosave
 * wipes the token and the next page load shows the paste UI again.
 */
function resolvePersistedSecret(
  previous: string | undefined,
  incoming: string | undefined,
  configuredFlag: boolean | undefined,
): string | undefined {
  const next = typeof incoming === 'string' ? incoming.trim() : '';
  if (next) return next;
  if (configuredFlag === false) return '';
  return previous;
}

/** Merge host config while preserving tunnel/telephony secrets (apiKeyConfigured pattern). */
export function mergeHostConfigPreservingSecrets(existing: HostConfig, incoming: HostConfig): HostConfig {
  const merged = mergeHostConfig(existing, incoming);

  const tunnelProviders: NonNullable<HostConfig['tunnelProviders']> = {
    ...(existing.tunnelProviders ?? {}),
  };
  for (const [id, cfg] of Object.entries(incoming.tunnelProviders ?? {})) {
    const prev = tunnelProviders[id] ?? {};
    const prevCreds = prev.credentials ?? {};
    const nextCreds = cfg.credentials ?? {};
    const authToken = resolvePersistedSecret(
      prevCreds.authToken,
      nextCreds.authToken,
      nextCreds.authTokenConfigured,
    );
    tunnelProviders[id] = {
      ...prev,
      ...cfg,
      credentials: {
        ...prevCreds,
        ...nextCreds,
        authToken,
        authTokenConfigured: undefined,
      },
    };
  }
  merged.tunnelProviders = tunnelProviders;

  const providers: NonNullable<NonNullable<HostConfig['telephony']>['providers']> = {
    ...(existing.telephony?.providers ?? {}),
  };
  for (const [id, cfg] of Object.entries(incoming.telephony?.providers ?? {})) {
    const prev = providers[id] ?? {};
    const prevCreds = prev.credentials ?? {};
    const nextCreds = cfg.credentials ?? {};
    const authToken = resolvePersistedSecret(
      prevCreds.authToken,
      nextCreds.authToken,
      nextCreds.authTokenConfigured,
    );
    const apiKey = resolvePersistedSecret(
      prevCreds.apiKey,
      nextCreds.apiKey,
      nextCreds.apiKeyConfigured,
    );
    const apiSecret = resolvePersistedSecret(
      prevCreds.apiSecret,
      nextCreds.apiSecret,
      nextCreds.apiSecretConfigured,
    );
    providers[id] = {
      ...prev,
      ...cfg,
      credentials: {
        ...prevCreds,
        ...nextCreds,
        authToken,
        apiKey,
        apiSecret,
        authTokenConfigured: undefined,
        apiKeyConfigured: undefined,
        apiSecretConfigured: undefined,
      },
      numbers: cfg.numbers ?? prev.numbers,
    };
  }
  merged.telephony = {
    ...existing.telephony,
    ...incoming.telephony,
    providers,
  };

  return merged;
}
