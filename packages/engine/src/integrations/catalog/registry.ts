import type { IntegrationCatalogStatus, IntegrationCategory, IntegrationProvider } from '@agentx/shared';
import { isChannelCoveredMcpIntegration } from '@agentx/shared';
import { SHIPPED_PROVIDERS } from './shipped.js';
import { withProviderHighlights } from './provider-highlights.js';

export interface CatalogListOptions {
  includeDeprecated?: boolean;
  status?: IntegrationCatalogStatus | IntegrationCatalogStatus[];
}

function matchesStatus(provider: IntegrationProvider, options: CatalogListOptions): boolean {
  const status = provider.catalogStatus ?? 'active';
  if (status === 'deprecated' && !options.includeDeprecated) return false;
  if (options.status) {
    const allowed = Array.isArray(options.status) ? options.status : [options.status];
    return allowed.includes(status);
  }
  return true;
}

/** Full catalog: shipped providers only. Candidates were removed — only
 *  Tier-1 (product-powered) and Tier-2 (modelcontextprotocol-powered) clients
 *  are kept in the store. */
export const INTEGRATION_CATALOG: IntegrationProvider[] = [
  ...SHIPPED_PROVIDERS,
];

export function listCatalogProviders(options: CatalogListOptions = {}): IntegrationProvider[] {
  return INTEGRATION_CATALOG
    .filter((provider) => !isChannelCoveredMcpIntegration(provider.id))
    .filter((provider) => matchesStatus(provider, options))
    .map(withProviderHighlights);
}

export function getCatalogProvider(id: string): IntegrationProvider | undefined {
  return INTEGRATION_CATALOG.find((provider) => provider.id === id);
}

export function listIntegrationCategories(): IntegrationCategory[] {
  return [...new Set(listCatalogProviders().map((provider) => provider.category))];
}

export function getCatalogStats(): Record<IntegrationCatalogStatus, number> {
  const stats: Record<IntegrationCatalogStatus, number> = {
    active: 0,
    candidate: 0,
    testing: 0,
    deprecated: 0,
  };
  for (const provider of INTEGRATION_CATALOG) {
    const status = provider.catalogStatus ?? 'active';
    stats[status] += 1;
  }
  return stats;
}

/** @deprecated Use listCatalogProviders */
export const INTEGRATION_PROVIDERS = listCatalogProviders();

export function getIntegrationProvider(id: string): IntegrationProvider | undefined {
  return getCatalogProvider(id);
}

export function listIntegrationProviders(): IntegrationProvider[] {
  return listCatalogProviders();
}
