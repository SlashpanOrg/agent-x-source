/**
 * MCP Integrations Hub — per-provider connect wizard metadata (MCP Store only).
 * Unrelated to first-run app setup in web-ui `pages/SetupWizard.tsx`.
 */
import type {
  ConnectGuideStep,
  IntegrationCategory,
  IntegrationProvider,
  ProviderSetupWizardSpec,
  SetupPreflightCheckId,
  SetupWizardTemplate,
} from '@agentx/shared';

const LIFESTYLE_CATEGORIES = new Set<IntegrationCategory>([
  'travel',
  'productivity',
  'communication',
  'finance',
  'shopping',
  'smart_home',
]);

function inferTemplate(provider: IntegrationProvider): SetupWizardTemplate {
  if (provider.id === 'custom') return 'custom';
  if (provider.auth.mcpStdioAuth) return 'mcp_stdio_auth';
  if (provider.auth.packageSignIn) return 'package_sign_in';
  if (provider.auth.primary === 'oauth' || provider.auth.primary === 'sign_in_browser') {
    return provider.server.type === 'remote' ? 'oauth_remote' : 'oauth_remote';
  }
  if (provider.id === 'filesystem') return 'folder_sandbox';
  if (provider.auth.primary === 'remote_url') return 'remote_url';
  if (provider.auth.primary === 'none' && provider.server.type === 'stdio') return 'stdio_none';
  if (provider.auth.fields?.some((f) => /DATABASE|REDIS|URL|CONNECTION/i.test(f.key))) {
    return 'connection_string';
  }
  return 'api_key';
}

function inferPreflight(provider: IntegrationProvider, template: SetupWizardTemplate): SetupPreflightCheckId[] {
  const checks: SetupPreflightCheckId[] = ['network_reachable', 'mcp_handshake'];
  if (provider.server.type === 'stdio' || template === 'stdio_none' || template === 'api_key' || template === 'connection_string' || template === 'folder_sandbox' || template === 'package_sign_in') {
    checks.unshift('npx_available', 'node_available');
  }
  if (provider.auth.oauth?.clientIdEnv) {
    checks.push('oauth_env_configured');
  }
  if (template === 'oauth_remote' && provider.server.type === 'remote') {
    checks.push('oauth_client_configured');
  }
  if (template === 'folder_sandbox') {
    checks.push('folder_readable', 'folder_writable');
  }
  if (provider.id === 'home-assistant') {
    checks.push('local_port_reachable');
  }
  return [...new Set(checks)];
}

/** Checks that require credentials — run after the credentials step, before test. */
export function inferCredentialPreflight(provider: IntegrationProvider): SetupPreflightCheckId[] {
  if (provider.id === 'postgres') return ['postgres_reachable'];
  if (provider.id === 'redis') return ['redis_reachable'];
  if (provider.id === 'sqlite') return ['folder_readable'];
  return [];
}

function inferOsPermissions(provider: IntegrationProvider, template: SetupWizardTemplate): ProviderSetupWizardSpec['osPermissions'] {
  if (template === 'folder_sandbox' || provider.id === 'filesystem') return ['folder_access'];
  if (provider.id === 'home-assistant') return ['local_network'];
  return undefined;
}

interface ProviderSetupCopy {
  highlights?: string[];
  connectGuide?: ConnectGuideStep[];
}

/**
 * Non-developer setup copy per provider: what it does (highlights) and how to get
 * credentials (connectGuide with deep links). Merged in only where the catalog does
 * not already define its own, so hand-authored catalog copy always wins.
 */
const PROVIDER_SETUP_COPY: Record<string, ProviderSetupCopy> = {
  fetch: {
    highlights: [
      'Read any public web page and return clean, readable text',
      'No account or API key needed — runs locally on your machine',
      'Great for summarising articles, docs, and reference pages',
    ],
    connectGuide: [
      { title: 'Nothing to configure', body: 'Fetch runs a local MCP server via npx. Just click Continue and test the connection.' },
    ],
  },
  notion: {
    highlights: [
      'Search, read, and update your Notion pages and databases',
      'Sign in securely with your Notion account — no tokens to copy',
      'Turn meeting notes and tasks into actions from chat',
    ],
    connectGuide: [
      { title: 'Sign in with Notion', body: 'A browser window opens for you to authorise Agent-X. Approve access to continue. If you see “Invalid redirect_uri”, click Sign in again — Agent-X registers a fresh OAuth client automatically.' },
      { title: 'Share your pages', body: 'After signing in, open Notion and share the pages or databases you want Agent-X to use (••• → Connections → Agent-X).', link: 'https://www.notion.so' },
    ],
  },
  linear: {
    highlights: [
      'Create, search, and update Linear issues from chat',
      'Sign in with your Linear workspace — no API key needed',
      'Track sprint progress and triage bugs hands-free',
    ],
    connectGuide: [
      { title: 'Sign in with Linear', body: 'Authorise Agent-X in the browser window. Choose the workspace you want to connect.' },
    ],
  },
  github: {
    highlights: [
      'Search repos, read issues and PRs, and manage code',
      'Review pull requests and open issues from chat',
      'Works with a fine-grained personal access token',
    ],
    connectGuide: [
      { title: 'Create a token', body: 'Open GitHub → Settings → Developer settings → Fine-grained tokens and generate a new token.', link: 'https://github.com/settings/tokens?type=beta' },
      { title: 'Pick scopes', body: 'Grant read access to repositories (and write if you want Agent-X to open issues/PRs).' },
      { title: 'Paste the token', body: 'Copy the token (starts with github_pat_) and paste it below.' },
    ],
  },
  'brave-search': {
    highlights: [
      'Private web search that respects your privacy',
      'Fresh results for research and fact-checking',
      'Free tier available from the Brave dashboard',
    ],
    connectGuide: [
      { title: 'Get an API key', body: 'Sign up for the Brave Search API and create a key from the dashboard.', link: 'https://brave.com/search/api/' },
      { title: 'Paste the key', body: 'Copy your subscription key and paste it below.' },
    ],
  },
  filesystem: {
    highlights: [
      'Let your agent read and write files in one folder you choose',
      'Access is sandboxed to the folder you pick — nothing else',
      'Great for organising documents and drafting files locally',
    ],
    connectGuide: [
      { title: 'Choose a folder', body: 'Pick the single folder Agent-X may read and write. You can change it later by reconnecting.' },
    ],
  },
  'google-maps': {
    highlights: ['Places, directions, and travel search', 'Plan trips and find nearby options'],
    connectGuide: [
      { title: 'Enable the API', body: 'In Google Cloud Console enable the Maps/Places APIs for a project.', link: 'https://console.cloud.google.com/google/maps-apis' },
      { title: 'Create an API key', body: 'Create an API key under Credentials and paste it below.' },
    ],
  },
  'google-drive': {
    highlights: ['Search and read your Google Drive files', 'Pull docs and sheets into your workflow'],
    connectGuide: [
      { title: 'Enable Google Drive API', body: 'Enable the Drive API in your Google Cloud project before connecting.', link: 'https://console.cloud.google.com/apis/library/drive.googleapis.com' },
      { title: 'Desktop OAuth client', body: 'Create a Desktop app OAuth client (not Web). Paste the Client ID and Secret in the wizard.' },
      { title: 'Test users (Testing mode)', body: 'If your consent screen is in Testing, add your Google email under Test users or Google returns access_denied.' },
    ],
  },
  stripe: {
    highlights: ['View customers, payments, and billing data', 'Answer revenue questions from chat'],
    connectGuide: [
      { title: 'Create a restricted key', body: 'In Stripe → Developers → API keys, create a restricted key with read scopes.', link: 'https://dashboard.stripe.com/apikeys' },
      { title: 'Paste the key', body: 'Use a test key (sk_test_) first to try it safely.' },
    ],
  },
  paypal: {
    highlights: ['Check balances, transactions, and invoices', 'Sandbox mode available for safe testing'],
    connectGuide: [
      { title: 'Create app credentials', body: 'In the PayPal Developer dashboard create an app and copy the client ID/secret.', link: 'https://developer.paypal.com/dashboard/' },
    ],
  },
  'home-assistant': {
    highlights: ['Control lights, switches, and scenes', 'Monitor sensors across your smart home'],
    connectGuide: [
      { title: 'Instance URL', body: 'Enter your Home Assistant MCP endpoint, e.g. https://your-home.example.com/mcp.' },
      { title: 'Long-lived token', body: 'In Home Assistant → Profile → Long-lived access tokens, create one and paste it below.' },
    ],
  },
  postgres: {
    highlights: ['Run read-only queries against your database', 'Explore schemas and answer data questions'],
    connectGuide: [
      { title: 'Connection string', body: 'Provide a read-only connection URL, e.g. postgres://user:pass@host:5432/db.' },
    ],
  },
  redis: {
    highlights: ['Inspect keys and run read-only Redis commands', 'Debug caches and queues from chat'],
    connectGuide: [
      { title: 'Redis URL', body: 'Provide your Redis connection URL, e.g. redis://localhost:6379.' },
    ],
  },
  sqlite: {
    highlights: ['Query local SQLite databases', 'Explore tables without writing SQL by hand'],
    connectGuide: [
      { title: 'Database file', body: 'Provide the path to your .db/.sqlite file. Choose a file you trust.' },
    ],
  },
  puppeteer: {
    highlights: ['Automate a real browser for scraping and testing', 'Downloads a Chromium build on first run'],
    connectGuide: [
      { title: 'First-run download', body: 'The first connection downloads Chromium (~150MB). This is normal and only happens once.' },
    ],
  },
  memory: {
    highlights: ['Persistent knowledge-graph memory for your agent', 'No account required'],
    connectGuide: [
      { title: 'Nothing to configure', body: 'Runs locally via npx. Click Continue and test the connection.' },
    ],
  },
  sentry: {
    highlights: ['Search issues and events across Sentry projects', 'Triage production errors from chat'],
    connectGuide: [
      { title: 'Create an auth token', body: 'In Sentry → Settings → Auth Tokens, create a token with project read scope.', link: 'https://sentry.io/settings/account/api/auth-tokens/' },
      { title: 'Paste the token', body: 'Copy the token (starts with sntrys_) and paste it below.' },
    ],
  },
  gmail: {
    highlights: [
      'Search and read messages in your inbox',
      'Send email with attachments (confirmed in chat)',
      'Manage labels, drafts, and folders',
    ],
    connectGuide: [
      { title: 'Enable Gmail API', body: 'In Google Cloud Console enable the Gmail API for your project.', link: 'https://console.cloud.google.com/apis/library/gmail.googleapis.com' },
      { title: 'OAuth consent screen', body: 'If the app is in Testing mode, add your Google email under Test users. Under Data access, add gmail.modify and gmail.settings.basic scopes.', link: 'https://console.cloud.google.com/apis/credentials/consent' },
      { title: 'Create a Web OAuth client', body: 'Application type must be Web application. Add your Agent-X callback URL under Authorized redirect URIs (shown on sign-in — default http://localhost:3333/oauth2callback).', link: 'https://console.cloud.google.com/apis/credentials/oauthclient' },
      { title: 'Sign in with Google', body: 'After saving credentials, click Sign in — a browser window opens for one-time Gmail authorization.' },
    ],
  },
  shopify: {
    highlights: ['Products, orders, and store analytics', 'Works with your Shopify Admin API token'],
    connectGuide: [
      { title: 'Create an app token', body: 'In Shopify Admin → Settings → Apps → Develop apps, create an app and generate an Admin API access token.', link: 'https://admin.shopify.com' },
      { title: 'Store domain', body: 'Enter your store domain (e.g. your-store.myshopify.com) below.' },
    ],
  },
};

/** Attach or infer per-provider setup wizard metadata for the MCP Store. */
export function enrichProviderSetupWizard(provider: IntegrationProvider): IntegrationProvider {
  const copy = PROVIDER_SETUP_COPY[provider.id];
  const highlights = provider.highlights?.length ? provider.highlights : copy?.highlights;
  const connectGuide = provider.auth.connectGuide?.length ? provider.auth.connectGuide : copy?.connectGuide;

  const withCopy: IntegrationProvider = (highlights !== provider.highlights || connectGuide !== provider.auth.connectGuide)
    ? {
        ...provider,
        highlights,
        auth: { ...provider.auth, connectGuide },
      }
    : provider;

  if (withCopy.setupWizard) return withCopy;

  const template = inferTemplate(withCopy);
  const preflight = inferPreflight(withCopy, template);
  const hideDeveloperTab = LIFESTYLE_CATEGORIES.has(withCopy.category) || withCopy.category !== 'dev_ops';
  return {
    ...withCopy,
    setupWizard: {
      template,
      preflight,
      osPermissions: inferOsPermissions(withCopy, template),
      hideDeveloperTab,
    },
  };
}

export function enrichCatalogProviders(providers: IntegrationProvider[]): IntegrationProvider[] {
  return providers.map(enrichProviderSetupWizard);
}
