import type { IntegrationProvider } from '@agentx/shared';

/** Human-readable capability bullets shown in the MCP Store detail modal. */
const HIGHLIGHTS: Record<string, string[]> = {
  github: ['Browse repos and code', 'Issues and pull requests', 'Search code'],
  notion: ['Search workspace pages', 'Read and update databases', 'Create pages'],
  linear: ['Issues and projects', 'Team workflows', 'Create and update tickets'],
  'brave-search': ['Live web search', 'Current events and facts'],
  postgres: ['Run read-only SQL', 'Inspect schemas and tables'],
  fetch: ['Fetch public URLs', 'Extract page text'],
  filesystem: ['Read files in allowed folder', 'Write files (confirmed)'],
  custom: ['Any MCP server by URL or command', 'Full stdio and remote support'],
  'google-drive': ['Search Drive files', 'Read and upload files'],
  'google-maps': ['Places search', 'Directions and routes', 'Travel time estimates'],
  redis: ['Inspect keys', 'Read-only Redis commands'],
  sqlite: ['Query local SQLite databases'],
  sentry: ['Issues and stack traces', 'Project health', 'Event search'],
  puppeteer: ['Browse pages', 'Screenshots and scraping (confirmed)'],
  memory: ['Persistent agent memory graph', 'Store and recall facts'],
  'home-assistant': ['Device state', 'Control lights and switches (confirmed)', 'Automations'],
  stripe: ['Customers and payments', 'Invoices', 'Charges (confirmed)'],
  paypal: ['Account activity', 'Payments (confirmed)'],
  shopify: ['Products and inventory', 'Orders', 'Fulfillment (confirmed)'],
  gmail: ['Search and read inbox messages', 'Send email with attachments (confirmed)', 'Manage labels and folders'],
};

export function getProviderHighlights(provider: IntegrationProvider): string[] {
  if (provider.highlights?.length) return provider.highlights;
  const mapped = HIGHLIGHTS[provider.id];
  if (mapped?.length) return mapped;
  const caps: string[] = [];
  if (provider.capabilities.search) caps.push('Search');
  if (provider.capabilities.read) caps.push('Read data');
  if (provider.capabilities.write) caps.push('Create and update (confirmed in chat)');
  if (provider.capabilities.transact) caps.push('Payments and bookings (confirmed in chat)');
  return caps.length > 0 ? caps : ['Connect to see available tools'];
}

export function withProviderHighlights(provider: IntegrationProvider): IntegrationProvider {
  return {
    ...provider,
    highlights: getProviderHighlights(provider),
  };
}
