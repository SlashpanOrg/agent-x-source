import { Router, type Request, type Response } from 'express';
import type { ConnectIntegrationRequest, IntegrationHubSettings } from '@agentx/shared';
import { isChannelCoveredMcpIntegration } from '@agentx/shared';
import { getEngine } from './engine.js';
import { validate, connectIntegrationSchema, mcpImportSchema, integrationSettingsSchema, integrationRunToolSchema } from './validation.js';
import { importMcpConfig, parseMcpImportConfig, startAppSpan } from '@agentx/engine';
import { metricsRegistry } from './metrics/MetricsRegistry.js';
import { oauthResultPage } from './integrations/oauth-callback-page.js';

const router: import('express').Router = Router();

function syncIntegrationTools(): void {
  const eng = getEngine();
  eng.integrationHub.syncToToolkit(eng.toolkit.registry, eng.toolkit.executor);
}

router.post('/integrations/maintain', async (_req: Request, res: Response) => {
  try {
    const eng = getEngine();
    await eng.integrationHub.maintainConnections();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'maintain-failed' });
  }
});

router.get('/integrations/catalog', (_req: Request, res: Response) => {
  const eng = getEngine();
  res.json({
    providers: eng.integrationHub.listCatalog(),
    settings: eng.integrationHub.getSettings(),
    stats: eng.integrationHub.getCatalogStats(),
  });
});

router.get('/integrations/connections', (_req: Request, res: Response) => {
  const eng = getEngine();
  res.json({
    connections: eng.integrationHub.listConnections().filter((c) => !isChannelCoveredMcpIntegration(c.providerId)),
  });
});

router.get('/integrations/audit', (req: Request, res: Response) => {
  const eng = getEngine();
  const limit = Number(req.query.limit ?? 100);
  res.json({ entries: eng.integrationHub.getAuditTail(Number.isFinite(limit) ? limit : 100) });
});

router.get('/integrations/analytics', (_req: Request, res: Response) => {
  const eng = getEngine();
  res.json({ analytics: eng.integrationHub.getAnalytics() });
});

router.get('/integrations/notifications', (req: Request, res: Response) => {
  const eng = getEngine();
  const limit = Number(req.query.limit ?? 100);
  res.json({
    notifications: eng.integrationHub.listNotifications(Number.isFinite(limit) ? limit : 100),
    count: eng.integrationHub.notificationCount(),
  });
});

router.post('/integrations/notifications/:id/dismiss', (req: Request, res: Response) => {
  const eng = getEngine();
  const id = req.params.id!;
  const ok = eng.integrationHub.dismissNotification(id);
  if (!ok) return res.status(404).json({ error: 'Notification not found' });
  res.json({ ok: true, count: eng.integrationHub.notificationCount() });
});

router.post('/integrations/notifications/dismiss-all', (_req: Request, res: Response) => {
  const eng = getEngine();
  const dismissed = eng.integrationHub.dismissAllNotifications();
  res.json({ ok: true, dismissed, count: eng.integrationHub.notificationCount() });
});

router.get('/integrations/settings', (_req: Request, res: Response) => {
  const eng = getEngine();
  res.json({ settings: eng.integrationHub.getSettings() });
});

router.post('/integrations/settings', validate(integrationSettingsSchema), (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const settings = req.body as IntegrationHubSettings;
    eng.integrationHub.updateSettings(settings);
    res.json({ settings: eng.integrationHub.getSettings() });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post('/integrations/import', validate(mcpImportSchema), async (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const config = parseMcpImportConfig(req.body);
    const result = await importMcpConfig(eng.integrationHub, config);
    syncIntegrationTools();
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post('/integrations/preflight', async (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const providerId = String(req.body?.providerId ?? '');
    const checks = Array.isArray(req.body?.checks) ? req.body.checks : undefined;
    const env = req.body?.env && typeof req.body.env === 'object' ? req.body.env as Record<string, string> : undefined;
    const folderPath = typeof req.body?.folderPath === 'string' ? req.body.folderPath : undefined;
    const remoteUrl = typeof req.body?.remoteUrl === 'string' ? req.body.remoteUrl : undefined;
    if (!providerId) return res.status(400).json({ error: 'providerId is required' });
    if (isChannelCoveredMcpIntegration(providerId)) {
      res.status(400).json({
        error: `${providerId} is configured under Settings → Channels, not MCP Store.`,
      });
      return;
    }
    const results = await eng.integrationHub.preflightProvider(providerId, checks, { env, folderPath, remoteUrl });
    res.json({ results });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post('/integrations/:providerId/connect-test', validate(connectIntegrationSchema), async (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const providerId = req.params.providerId!;
    const body = req.body as ConnectIntegrationRequest;
    const result = await eng.integrationHub.probeConnection(providerId, body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post('/integrations/:providerId/connect', validate(connectIntegrationSchema), async (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const providerId = req.params.providerId!;
    if (isChannelCoveredMcpIntegration(providerId)) {
      res.status(400).json({
        error: `${providerId} is configured under Settings → Channels. Remove the MCP connection and use Channels instead.`,
      });
      return;
    }
    const body = req.body as ConnectIntegrationRequest;
    const connection = await eng.integrationHub.connect(providerId, body);
    syncIntegrationTools();
    res.json({ connection });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post('/integrations/:providerId/oauth/start', async (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const providerId = req.params.providerId!;
    const remoteResourceUrl = typeof req.body?.remoteUrl === 'string' ? req.body.remoteUrl : undefined;
    const result = await eng.integrationHub.startOAuth(providerId, remoteResourceUrl);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.get('/integrations/oauth/redirect-uri', (_req: Request, res: Response) => {
  res.json({ redirectUri: getEngine().integrationHub.getOAuthRedirectUri() });
});

router.get('/integrations/oauth/result', (req: Request, res: Response) => {
  const state = String(req.query.state ?? '');
  const eng = getEngine();
  res.json({ result: eng.integrationHub.getOAuthResult(state) });
});

router.get('/integrations/oauth/callback', async (req: Request, res: Response) => {
  const state = String(req.query.state ?? '');
  const code = String(req.query.code ?? '');
  const errorParam = String(req.query.error ?? '');
  const acceptsHtml = (req.headers.accept ?? '').includes('text/html');

  if (errorParam) {
    const message = errorParam === 'access_denied'
      ? 'OAuth denied: access was not granted.'
      : /redirect_uri/i.test(errorParam)
        ? `OAuth redirect URI mismatch (${errorParam}). Click Sign in again — Agent-X will register a fresh OAuth client.`
        : `OAuth denied: ${errorParam}`;
    if (state) getEngine().integrationHub.recordOAuthFailure(state, message);
    if (acceptsHtml) {
      return res.status(400).send(oauthResultPage(false, message));
    }
    return res.status(400).json({ error: message });
  }

  if (!state || !code) {
    const message = 'Missing state or authorization code';
    if (state) getEngine().integrationHub.recordOAuthFailure(state, message);
    if (acceptsHtml) return res.status(400).send(oauthResultPage(false, message));
    return res.status(400).json({ error: message });
  }

  try {
    const eng = getEngine();
    const connection = await eng.integrationHub.completeOAuth(state, code);
    syncIntegrationTools();
    if (acceptsHtml) {
      return res.send(oauthResultPage(true, `Connected to ${connection.displayName}`, {
        connectionId: connection.id,
        providerId: connection.providerId,
      }));
    }
    res.json({ connection });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    getEngine().integrationHub.recordOAuthFailure(state, message);
    if (acceptsHtml) return res.status(400).send(oauthResultPage(false, message));
    res.status(400).json({ error: message });
  }
});

router.post('/integrations/:connectionId/mcp-auth', async (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const connectionId = req.params.connectionId!;
    const result = await eng.integrationHub.runMcpStdioAuth(connectionId);
    if (result.success) syncIntegrationTools();
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post('/integrations/:connectionId/mcp-auth/start', async (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const connectionId = req.params.connectionId!;
    const result = await eng.integrationHub.startMcpStdioBrowserOAuth(connectionId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.get('/integrations/mcp-auth/result', (req: Request, res: Response) => {
  const state = String(req.query.state ?? '');
  const eng = getEngine();
  res.json({ result: eng.integrationHub.getMcpStdioOAuthResult(state) });
});

router.get('/integrations/mcp-auth/redirect-uri', (req: Request, res: Response) => {
  const providerId = String(req.query.providerId ?? 'gmail');
  const eng = getEngine();
  res.json({ redirectUri: eng.integrationHub.getMcpStdioOAuthRedirectUri(providerId) });
});

router.get('/integrations/:connectionId/mcp-auth/status', (req: Request, res: Response) => {
  const eng = getEngine();
  const connectionId = req.params.connectionId!;
  res.json(eng.integrationHub.getMcpStdioAuthStatus(connectionId));
});

router.get('/integrations/:connectionId/resources', async (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const connectionId = req.params.connectionId!;
    const uri = String(req.query.uri ?? '');
    if (!uri) return res.status(400).json({ error: 'uri query parameter is required' });
    const resource = await eng.integrationHub.readIntegrationResource(connectionId, uri);
    res.json({ resource });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.delete('/integrations/:connectionId', async (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const connectionId = req.params.connectionId!;
    await eng.integrationHub.disconnect(connectionId);
    syncIntegrationTools();
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post('/integrations/:connectionId/sync', async (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const connectionId = req.params.connectionId!;
    const connection = await eng.integrationHub.syncConnection(connectionId);
    syncIntegrationTools();
    res.json({ connection });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post('/integrations/:connectionId/benchmark', async (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const connectionId = req.params.connectionId!;
    const connection = await eng.integrationHub.benchmarkConnection(connectionId);
    res.json({ connection });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post('/integrations/:connectionId/run-tool', validate(integrationRunToolSchema), async (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const connectionId = req.params.connectionId!;
    const { toolName, args } = req.body as { toolName: string; args?: Record<string, unknown> };
    const connection = eng.integrationHub.listConnections().find((c) => c.id === connectionId);
    const serverName = connection?.providerId ?? 'unknown';
    const startedAt = Date.now();
    const { span, withContext } = startAppSpan(
      `integration.${serverName}.${toolName}`,
      'integration_call',
      'integration_call',
      {
        'integration.server': serverName,
        'integration.tool': toolName,
        'integration.args': JSON.stringify(args ?? {}),
      },
    );
    let success = false;
    try {
      const result = await withContext(() => eng.integrationHub.runStoreTool(connectionId, toolName, args ?? {}));
      success = result.success;
      span.setAttribute('integration.output', typeof result.output === 'string' ? result.output.slice(0, 2000) : JSON.stringify(result.output).slice(0, 2000));
      span.setAttribute('integration.success', success);
      span.setAttribute('integration.duration_ms', Date.now() - startedAt);
      syncIntegrationTools();
      res.json({ result });
    } catch (error) {
      span.setAttribute('integration.success', false);
      span.setAttribute('integration.duration_ms', Date.now() - startedAt);
      span.recordError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      span.end();
      metricsRegistry.incrementCounter('integration_calls_total', { server: serverName, tool: toolName, success: String(success) }, 1);
    }
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.get('/integrations/:connectionId/health', (req: Request, res: Response) => {
  const eng = getEngine();
  const connectionId = req.params.connectionId!;
  const health = eng.integrationHub.getHealth(connectionId);
  if (!health) {
    return res.status(404).json({ error: 'Connection not found' });
  }
  res.json({ health });
});

router.get('/integrations/:connectionId/tools', (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const connectionId = req.params.connectionId!;
    const mapped = eng.integrationHub.getConnectionToolDefinitions(connectionId);
    if (!mapped) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    const connection = eng.integrationHub.listConnections().find((c) => c.id === connectionId);
    const benchmarks = new Map((connection?.toolBenchmarks ?? []).map((b) => [b.mcpName, b]));
    const cfg = eng.configManager.load();
    const permissions = cfg.permissions ?? {};
    const tools = mapped.map(({ mcpName, definition }) => {
      const defaultDecision = definition.riskLevel === 'low' ? 'allow' : definition.riskLevel === 'critical' ? 'deny' : 'ask';
      const bench = benchmarks.get(mcpName);
      return {
        mcpName,
        name: definition.name,
        description: definition.description,
        riskLevel: definition.riskLevel,
        defaultDecision: permissions[definition.id] ?? defaultDecision,
        benchmarkStatus: bench?.status,
        benchmarkError: bench?.error,
        benchmarkSkipReason: bench?.skipReason,
        lastTestedAt: bench?.testedAt,
        readonly: bench?.readonly ?? definition.riskLevel === 'low',
      };
    });
    res.json({
      tools,
      lastBenchmarkAt: connection?.lastBenchmarkAt,
      benchmarkSummary: connection?.benchmarkSummary,
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export { router as integrationsRouter };

/** Google Gmail MCP OAuth callback — must match redirect URI registered in Google Cloud Console. */
export async function handleMcpStdioOAuthCallback(req: Request, res: Response): Promise<void> {
  const state = String(req.query.state ?? '');
  const code = String(req.query.code ?? '');
  const errorParam = String(req.query.error ?? '');
  const acceptsHtml = (req.headers.accept ?? '').includes('text/html');

  if (errorParam) {
    const message = errorParam === 'access_denied'
      ? 'Google sign-in denied: access was not granted.'
      : /redirect_uri/i.test(errorParam)
        ? `OAuth redirect URI mismatch (${errorParam}). Add the callback URL shown in the Gmail setup wizard to Google Cloud Console.`
        : `Google sign-in denied: ${errorParam}`;
    if (state) getEngine().integrationHub.recordMcpStdioOAuthFailure(state, message);
    if (acceptsHtml) {
      res.status(400).send(oauthResultPage(false, message));
      return;
    }
    res.status(400).json({ error: message });
    return;
  }

  if (!state || !code) {
    const message = 'Missing state or authorization code';
    if (state) getEngine().integrationHub.recordMcpStdioOAuthFailure(state, message);
    if (acceptsHtml) {
      res.status(400).send(oauthResultPage(false, message));
      return;
    }
    res.status(400).json({ error: message });
    return;
  }

  try {
    const eng = getEngine();
    const connection = await eng.integrationHub.completeMcpStdioBrowserOAuth(state, code);
    syncIntegrationTools();
    if (acceptsHtml) {
      res.send(oauthResultPage(true, `Signed in to ${connection.displayName}`, {
        connectionId: connection.id,
        providerId: connection.providerId,
      }));
      return;
    }
    res.json({ connection });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    getEngine().integrationHub.recordMcpStdioOAuthFailure(state, message);
    if (acceptsHtml) {
      res.status(400).send(oauthResultPage(false, message));
      return;
    }
    res.status(400).json({ error: message });
  }
}
