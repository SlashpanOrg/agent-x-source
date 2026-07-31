import type {
  IntegrationCatalogStatus,
  IntegrationCategory,
  IntegrationProvider,
  IntegrationTrust,
} from '@agentx/shared';

export const field = (
  key: string,
  label: string,
  placeholder?: string,
  secret = true,
): NonNullable<IntegrationProvider['auth']['fields']>[number] => ({
  key,
  label,
  placeholder,
  secret,
  required: true,
});

export function stdioNpx(pkg: string, extraArgs: string[] = []): IntegrationProvider['server'] {
  return {
    type: 'stdio',
    command: 'npx',
    args: ['-y', pkg, ...extraArgs],
    package: pkg,
  };
}

export function remoteMcp(url: string, packageLabel?: string): IntegrationProvider['server'] {
  return { type: 'remote', url, package: packageLabel ?? url };
}

interface ProviderBase {
  id: string;
  name: string;
  category: IntegrationCategory;
  description: string;
  icon: string;
  website?: string;
  trust?: IntegrationTrust;
  catalogStatus?: IntegrationCatalogStatus;
  npmPackage?: string;
  evaluationNotes?: string;
  server: IntegrationProvider['server'];
  auth: IntegrationProvider['auth'];
  capabilities: IntegrationProvider['capabilities'];
  tools?: IntegrationProvider['tools'];
  connectGuide?: IntegrationProvider['auth']['connectGuide'];
}

export function defineProvider(base: ProviderBase): IntegrationProvider {
  return {
    ...base,
    trust: base.trust ?? 'verified',
    catalogStatus: base.catalogStatus ?? 'active',
  };
}
