import type {
  TelephonyCapabilities,
  TelephonyProviderCatalogEntry,
  TelephonyProviderId,
} from '@agentx/shared';
import { DEFAULT_TELEPHONY_CAPABILITIES } from '@agentx/shared';
import type { TelephonyProviderAdapter } from './ITelephonyProvider.js';

/**
 * Plug-n-play registry for telephony vendors.
 * Adding a vendor = implement TelephonyProviderAdapter + register() at boot.
 */
export class TelephonyRegistry {
  private readonly adapters = new Map<string, TelephonyProviderAdapter>();
  private readonly catalogOverrides = new Map<string, TelephonyProviderCatalogEntry>();

  register(adapter: TelephonyProviderAdapter, catalog?: TelephonyProviderCatalogEntry): void {
    this.adapters.set(adapter.id, adapter);
    if (catalog) {
      this.catalogOverrides.set(adapter.id, catalog);
    } else if (adapter.catalog) {
      const base = SHIPPED_TELEPHONY_CATALOG.find((c) => c.id === adapter.id);
      this.catalogOverrides.set(adapter.id, {
        ...(base ?? {
          id: adapter.id,
          name: adapter.id,
          tagline: '',
          setupSteps: [],
          credentialFields: [],
          capabilities: adapter.capabilities,
        }),
        ...adapter.catalog,
        id: adapter.id,
        capabilities: adapter.capabilities,
      });
    }
  }

  unregister(providerId: TelephonyProviderId): void {
    this.adapters.delete(providerId);
    this.catalogOverrides.delete(providerId);
  }

  get(providerId: TelephonyProviderId): TelephonyProviderAdapter | undefined {
    return this.adapters.get(providerId);
  }

  require(providerId: TelephonyProviderId): TelephonyProviderAdapter {
    const adapter = this.get(providerId);
    if (!adapter) {
      throw new Error(`Telephony provider not registered: ${providerId}`);
    }
    return adapter;
  }

  list(): TelephonyProviderAdapter[] {
    return Array.from(this.adapters.values());
  }

  listCatalog(options: { includeTesting?: boolean } = {}): TelephonyProviderCatalogEntry[] {
    const ids = new Set<string>([
      ...SHIPPED_TELEPHONY_CATALOG.map((c) => c.id),
      ...this.adapters.keys(),
    ]);
    const entries: TelephonyProviderCatalogEntry[] = [];
    for (const id of ids) {
      const entry = this.getCatalogEntry(id);
      if (!entry) continue;
      if (entry.testingOnly && !options.includeTesting) continue;
      entries.push(entry);
    }
    return entries;
  }

  getCatalogEntry(providerId: string): TelephonyProviderCatalogEntry | undefined {
    const override = this.catalogOverrides.get(providerId);
    if (override) return override;
    const shipped = SHIPPED_TELEPHONY_CATALOG.find((c) => c.id === providerId);
    if (shipped) {
      const adapter = this.adapters.get(providerId);
      if (adapter) {
        return { ...shipped, capabilities: adapter.capabilities };
      }
      return shipped;
    }
    const adapter = this.adapters.get(providerId);
    if (!adapter) return undefined;
    return {
      id: adapter.id,
      name: adapter.id,
      tagline: '',
      setupSteps: [],
      credentialFields: [],
      capabilities: adapter.capabilities,
    };
  }

  hasCapability(
    providerId: TelephonyProviderId,
    capability: keyof TelephonyCapabilities,
  ): boolean {
    const adapter = this.get(providerId);
    if (!adapter) return false;
    const value = adapter.capabilities[capability];
    return typeof value === 'boolean' ? value : false;
  }

  clear(): void {
    this.adapters.clear();
    this.catalogOverrides.clear();
  }
}

export const SHIPPED_TELEPHONY_CATALOG: TelephonyProviderCatalogEntry[] = [
  {
    id: 'twilio',
    name: 'Twilio',
    tagline: 'Global voice, media streams, and SMS',
    accent: '#F22F46',
    setupSteps: [
      'Create a Twilio account and open the Console.',
      'Copy Account SID and Auth Token.',
      'Buy or port a phone number with Voice enabled.',
      'Paste credentials below and click Test connection.',
    ],
    credentialFields: [
      { key: 'accountId', label: 'Account SID', required: true, placeholder: 'ACxxxxxxxx' },
      {
        key: 'authToken',
        label: 'Auth Token',
        secret: true,
        required: true,
        placeholder: 'Paste auth token',
        helperText: 'Stored encrypted. Never shown again.',
      },
    ],
    capabilities: {
      ...DEFAULT_TELEPHONY_CAPABILITIES,
      inboundCalls: true,
      outboundCalls: true,
      bidirectionalMediaStreams: true,
      dtmf: true,
      recording: true,
      transcription: false,
      transfer: true,
      sms: true,
      numberProvisioning: true,
      webhookSignatureVerification: true,
      supportedCountries: ['US', 'CA', 'GB', 'AU', 'IN', 'DE', 'FR', 'SG'],
    },
    highlightedCountries: ['US', 'GB', 'IN', 'AU'],
  },
  {
    id: 'fake',
    name: 'Fake (tests)',
    tagline: 'Deterministic adapter for automated tests',
    setupSteps: ['Enabled automatically in test environments.'],
    credentialFields: [],
    capabilities: {
      ...DEFAULT_TELEPHONY_CAPABILITIES,
      inboundCalls: true,
      outboundCalls: true,
      bidirectionalMediaStreams: true,
      dtmf: true,
      recording: true,
      transfer: true,
      sms: true,
      numberProvisioning: true,
      webhookSignatureVerification: true,
      supportedCountries: ['XX'],
    },
    testingOnly: true,
  },
];

let singleton: TelephonyRegistry | null = null;

export function getTelephonyRegistry(): TelephonyRegistry {
  if (!singleton) singleton = new TelephonyRegistry();
  return singleton;
}

export function setTelephonyRegistry(registry: TelephonyRegistry | null): void {
  singleton = registry;
}
