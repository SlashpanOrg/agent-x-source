import { describe, expect, it } from 'vitest';
import {
  isReadOnlyIntegrationTool,
  integrationToolRiskLevel,
  integrationToolId,
  parseIntegrationToolId,
} from '../src/integrations/action-classifier.js';
import { adaptMcpTool } from '../src/integrations/mcp/tool-adapter.js';
import { buildIntegrationActionPreview } from '../src/integrations/action-preview.js';
import { getIntegrationProvider, listIntegrationProviders, getCatalogStats, listCatalogProviders } from '../src/integrations/catalog/index.js';
import { parseMcpImportConfig } from '../src/integrations/mcp-config-import.js';
import { expandStdioArgs } from '../src/integrations/stdio-args.js';
import { createGoogleDriveBridgeTools } from '../src/integrations/mcp/google-drive-bridge.js';
import { formatStdioSpawnError, resolveStdioCommand } from '@agentx/shared';
import {
  canUseHubBrowserOAuth,
  requiresRemoteUrlForHubOAuth,
  resolveProviderOAuthConfig,
} from '@agentx/shared';

describe('action-classifier', () => {
  const github = getIntegrationProvider('github');

  it('classifies read tools as readonly', () => {
    expect(isReadOnlyIntegrationTool('list_issues', github)).toBe(true);
    expect(integrationToolRiskLevel('list_issues', github)).toBe('low');
  });

  it('classifies write tools as confirm-first', () => {
    expect(isReadOnlyIntegrationTool('create_issue', github)).toBe(false);
    expect(integrationToolRiskLevel('create_issue', github)).toBe('medium');
  });

  it('classifies shopify search tools as readonly', () => {
    const shopify = getIntegrationProvider('shopify')!;
    expect(isReadOnlyIntegrationTool('search_products', shopify)).toBe(true);
    expect(isReadOnlyIntegrationTool('get_order', shopify)).toBe(true);
    expect(isReadOnlyIntegrationTool('create_order', shopify)).toBe(false);
  });

  it('round-trips integration tool ids', () => {
    const id = integrationToolId('github', 'create_issue');
    expect(id).toMatch(/^[a-zA-Z0-9_-]{1,128}$/);
    expect(parseIntegrationToolId(id)).toEqual({ providerId: 'github', toolName: 'create_issue' });
  });

});

describe('tool-adapter', () => {
  it('maps MCP tools to integration ToolDefinition', () => {
    const provider = getIntegrationProvider('fetch')!;
    const tool = adaptMcpTool(provider, {
      name: 'fetch',
      description: 'Fetch a URL',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'URL' } },
        required: ['url'],
      },
    });
    expect(tool.id).toBe('integration__fetch__fetch');
    expect(tool.source).toBe('integration');
    expect(tool.category).toBe('integrations');
    expect(tool.riskLevel).toBe('low');
  });
});

describe('action-preview', () => {
  it('builds structured preview for integration write tools', () => {
    const provider = getIntegrationProvider('github')!;
    const tool = adaptMcpTool(provider, { name: 'create_issue', description: 'Create an issue' });
    const preview = buildIntegrationActionPreview(tool.id, { repo: 'org/repo', title: 'bug' }, tool);
    expect(preview?.providerName).toBe('GitHub');
    expect(preview?.parameters.length).toBeGreaterThan(0);
  });
});

describe('mcp import', () => {
  it('parses desktop client mcp.json shape', () => {
    const config = parseMcpImportConfig({
      mcpServers: {
        fetch: { command: 'npx', args: ['-y', '@pulsemcp/pulse-fetch'] },
      },
    });
    expect(config.mcpServers.fetch?.command).toBe('npx');
  });
});

describe('catalog', () => {
  it('has at least 20 active providers including lifestyle categories', () => {
    const providers = listIntegrationProviders();
    expect(providers.length).toBeGreaterThanOrEqual(20);
    const categories = new Set(providers.map((p) => p.category));
    expect(categories.has('finance')).toBe(true);
    expect(categories.has('shopping')).toBe(true);
    expect(categories.has('travel')).toBe(true);
  });

  it('has a verified catalog of shipped providers', () => {
    const stats = getCatalogStats();
    expect(stats.active).toBeGreaterThanOrEqual(20);
    expect(stats.candidate).toBeGreaterThanOrEqual(0);
    const all = listCatalogProviders();
    expect(all.length).toBeGreaterThanOrEqual(20);
    const zomato = all.find((p) => p.id === 'zomato');
    expect(zomato?.catalogStatus).toBe('candidate');
    expect(zomato?.auth.oauth?.redirectAllowlistRequired).toBe(true);
  });

  it('expands HOME in stdio args', () => {
    const expanded = expandStdioArgs(['${HOME}']);
    expect(expanded[0]).not.toBe('${HOME}');
  });

  it('formats npx ENOENT as an actionable install message', () => {
    const message = formatStdioSpawnError(new Error('spawn npx ENOENT'), 'npx');
    expect(message).toContain('Node.js/npx was not found');
  });

  it('resolves absolute stdio commands unchanged', () => {
    expect(resolveStdioCommand('/usr/local/bin/npx')).toBe('/usr/local/bin/npx');
  });
});

describe('hub browser oauth', () => {
  it('enables browser sign-in for remote MCP OAuth servers', () => {
    const notion = getIntegrationProvider('notion')!;
    const linear = getIntegrationProvider('linear')!;
    expect(canUseHubBrowserOAuth(notion)).toBe(true);
    expect(canUseHubBrowserOAuth(linear)).toBe(true);
    expect(requiresRemoteUrlForHubOAuth(notion)).toBe(false);
    expect(resolveProviderOAuthConfig(notion).resource).toBe('https://mcp.notion.com/mcp');
  });

  it('does not offer hub OAuth for stdio filesystem server', () => {
    const filesystem = getIntegrationProvider('filesystem')!;
    expect(canUseHubBrowserOAuth(filesystem)).toBe(false);
    expect(filesystem.server.type).toBe('stdio');
  });

  it('uses MCP stdio auth for google-drive instead of hub OAuth', () => {
    const gdrive = getIntegrationProvider('google-drive')!;
    expect(gdrive.auth.mcpStdioAuth?.authArg).toBe('auth');
    expect(canUseHubBrowserOAuth(gdrive)).toBe(false);
  });

  it('uses MCP stdio auth for gmail instead of hub OAuth', () => {
    const gmail = getIntegrationProvider('gmail')!;
    expect(gmail.catalogStatus).toBe('active');
    expect(gmail.auth.mcpStdioAuth?.authArg).toBe('auth');
    expect(gmail.auth.mcpStdioAuth?.oauthPathEnv).toBe('GMAIL_OAUTH_PATH');
    expect(gmail.auth.mcpStdioAuth?.credentialsFileName).toBe('credentials.json');
    expect(gmail.auth.mcpStdioAuth?.oauthKeysFormat).toBe('web');
    expect(canUseHubBrowserOAuth(gmail)).toBe(false);
  });

  it('registers Google Drive bridge tools for read/list', () => {
    const gdrive = getIntegrationProvider('google-drive')!;
    const bridges = createGoogleDriveBridgeTools(gdrive);
    expect(bridges.map((b) => b.definition.id)).toEqual([
      'integration__google-drive__read_file',
      'integration__google-drive__list_files',
    ]);
  });

  it('requires MCP URL for remote_url OAuth providers', () => {
    const ha = getIntegrationProvider('home-assistant')!;
    expect(canUseHubBrowserOAuth(ha)).toBe(true);
    expect(requiresRemoteUrlForHubOAuth(ha)).toBe(true);
  });

  it('does not offer hub OAuth for stdio packages without discovery config', () => {
    const gmail = getIntegrationProvider('gmail')!;
    expect(canUseHubBrowserOAuth(gmail)).toBe(false);
  });
});
