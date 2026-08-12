import type { TelephonyConfig, TelephonyProviderCredentials } from '@agentx/shared';
import { getLogger, mergeTelephonyConfig } from '@agentx/shared';
import type {
  CredentialValidation,
  OutboundCallRequest,
  ProviderCall,
  TelephonyProviderAdapter,
} from './ITelephonyProvider.js';
import { getTelephonyRegistry, type TelephonyRegistry } from './TelephonyRegistry.js';
import { FakeTelephonyAdapter } from './adapters/FakeTelephonyAdapter.js';
import { TwilioAdapter } from './adapters/TwilioAdapter.js';

export interface TelephonyServiceOptions {
  registry?: TelephonyRegistry;
  /** When true, register the fake adapter (tests / NODE_ENV=test). */
  includeFake?: boolean;
}

/**
 * Owns provider lookup, capability checks, and credential validation.
 * Mission/session persistence hooks land in later Host phases.
 */
export class TelephonyService {
  private readonly registry: TelephonyRegistry;
  private config: TelephonyConfig = mergeTelephonyConfig();

  constructor(options: TelephonyServiceOptions = {}) {
    this.registry = options.registry ?? getTelephonyRegistry();
    this.ensureBuiltinAdapters(options.includeFake ?? process.env['NODE_ENV'] === 'test');
  }

  private ensureBuiltinAdapters(includeFake: boolean): void {
    if (!this.registry.get('twilio')) {
      this.registry.register(new TwilioAdapter());
    }
    if (includeFake && !this.registry.get('fake')) {
      this.registry.register(new FakeTelephonyAdapter());
    }
  }

  getRegistry(): TelephonyRegistry {
    return this.registry;
  }

  applyConfig(config: TelephonyConfig | null | undefined): void {
    this.config = mergeTelephonyConfig(this.config, config);
  }

  getConfig(): TelephonyConfig {
    return this.config;
  }

  getActiveAdapter(): TelephonyProviderAdapter | undefined {
    const id = this.config.activeProviderId;
    if (!id) return undefined;
    return this.registry.get(id);
  }

  requireActiveAdapter(): TelephonyProviderAdapter {
    const adapter = this.getActiveAdapter();
    if (!adapter) {
      throw new Error('No active telephony provider configured');
    }
    return adapter;
  }

  getCredentials(providerId: string): TelephonyProviderCredentials {
    return this.config.providers?.[providerId]?.credentials ?? {};
  }

  async testCredentials(providerId: string): Promise<CredentialValidation> {
    const adapter = this.registry.require(providerId);
    const credentials = this.getCredentials(providerId);
    return adapter.validateCredentials({ credentials });
  }

  assertCapability(providerId: string, capability: keyof import('@agentx/shared').TelephonyCapabilities): void {
    if (!this.registry.hasCapability(providerId, capability)) {
      throw new Error(`Provider ${providerId} does not support ${capability}`);
    }
  }

  async createOutboundCall(input: OutboundCallRequest): Promise<ProviderCall> {
    const adapter = this.requireActiveAdapter();
    this.assertCapability(adapter.id, 'outboundCalls');
    try {
      return await adapter.createOutboundCall(input);
    } catch (err) {
      getLogger().error('TELEPHONY_OUTBOUND_FAILED', err, { providerId: adapter.id });
      throw err;
    }
  }
}

let telephonyServiceSingleton: TelephonyService | null = null;

export function getTelephonyService(): TelephonyService {
  if (!telephonyServiceSingleton) {
    telephonyServiceSingleton = new TelephonyService();
  }
  return telephonyServiceSingleton;
}

export function setTelephonyService(service: TelephonyService | null): void {
  telephonyServiceSingleton = service;
}

export function bootstrapTelephonyAdapters(options?: { includeFake?: boolean }): TelephonyService {
  const service = new TelephonyService(options);
  setTelephonyService(service);
  return service;
}
