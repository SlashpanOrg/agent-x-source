/**
 * Host / public-edge configuration and exposure state.
 * Tunnel providers register behind PublicEdgeGateway — never hard-code ngrok in the UI.
 */

import type { TelephonyConfig } from './telephony.js';

export type HostExposureState =
  | 'LOCAL_ONLY'
  | 'LAN_REACHABLE'
  | 'PUBLIC_DIRECT_UNSAFE'
  | 'PUBLIC_TUNNEL_SECURED'
  | 'DEGRADED'
  | 'DISABLED'
  | 'UNKNOWN';

export type TunnelLifecycleState =
  | 'disabled'
  | 'preparing'
  | 'authenticating'
  | 'starting'
  | 'verifying'
  | 'active'
  | 'stopping'
  | 'stopped'
  | 'error';

/** Stable tunnel provider ids. New edge vendors plug in via the registry. */
export type TunnelProviderId = 'ngrok' | 'cloudflare' | 'fake' | (string & {});

export interface HostExposureScope {
  web: boolean;
  voice: boolean;
  telephonyWebhooks: boolean;
}

export interface HostSessionPolicy {
  idleTimeoutMinutes: number;
  absoluteTimeoutHours: number;
  maxRemoteSessions: number;
}

export interface HostTunnelConfig {
  region?: string;
  autostart?: boolean;
}

export interface TunnelProviderCredentials {
  /** Authtoken / API token — write-only from client. */
  authToken?: string;
  authTokenConfigured?: boolean;
  /** Non-secret account / domain identifiers. */
  accountId?: string;
  extras?: Record<string, string>;
}

export interface TunnelProviderConfig {
  enabled?: boolean;
  credentials?: TunnelProviderCredentials;
}

export interface TunnelCredentialField {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  helperText?: string;
  required?: boolean;
}

/** Declarative catalog entry — Host → Public Edge provider cards. */
export interface TunnelProviderCatalogEntry {
  id: TunnelProviderId;
  name: string;
  tagline: string;
  accent?: string;
  setupSteps: string[];
  credentialFields: TunnelCredentialField[];
  supportsRegion?: boolean;
  testingOnly?: boolean;
}

export interface HostConfig {
  /** Master switch — public access never starts without this (and explicit tunnel start). */
  publicAccess?: boolean;
  /** Active tunnel provider id. */
  provider?: TunnelProviderId | null;
  exposure?: HostExposureScope;
  sessionPolicy?: HostSessionPolicy;
  tunnel?: HostTunnelConfig;
  /** Allow remote browser login over the tunnel (still requires Agent-X auth). */
  allowRemoteLogin?: boolean;
  /** Per-provider tunnel credentials. */
  tunnelProviders?: Record<string, TunnelProviderConfig>;
  /**
   * VOIP / telephony lives under Host for a single Settings surface.
   * Secrets stay encrypted; UI uses apiKeyConfigured-style flags.
   */
  telephony?: TelephonyConfig;
}

export interface HostAddressInfo {
  address: string;
  family: 'IPv4' | 'IPv6';
  scope: 'loopback' | 'link_local' | 'private' | 'cgnat' | 'public' | 'unknown';
  internal: boolean;
  interfaceName?: string;
}

export interface HostNetworkSnapshot {
  bindHost: string;
  bindPort: number;
  loopbackUrl: string;
  lanUrls: string[];
  addresses: HostAddressInfo[];
  publicIp?: string | null;
  publicIpConfidence: 'none' | 'unverified' | 'provider' | 'challenge';
  natUncertainty: boolean;
}

export interface TunnelStatus {
  providerId: TunnelProviderId | null;
  state: TunnelLifecycleState;
  publicUrl?: string | null;
  tunnelId?: string | null;
  region?: string | null;
  protocol?: 'https' | 'http' | 'wss' | null;
  pid?: number | null;
  startedAt?: string | null;
  lastError?: string | null;
  verifiedUpstream?: boolean;
}

export interface SecurityPostureCheck {
  id: string;
  label: string;
  pass: boolean;
  severity: 'info' | 'warn' | 'critical';
  remediation?: string;
}

export interface SecurityPosture {
  checks: SecurityPostureCheck[];
  passCount: number;
  failCount: number;
  readyForPublicAccess: boolean;
}

export interface HostStatusSnapshot {
  exposureState: HostExposureState;
  network: HostNetworkSnapshot;
  tunnel: TunnelStatus;
  security: SecurityPosture;
  config: HostConfig;
  activeRemoteSessions: number;
  updatedAt: string;
}

export function defaultHostConfig(): HostConfig {
  return {
    publicAccess: false,
    provider: null,
    exposure: {
      web: true,
      voice: false,
      telephonyWebhooks: false,
    },
    sessionPolicy: {
      idleTimeoutMinutes: 30,
      absoluteTimeoutHours: 12,
      maxRemoteSessions: 3,
    },
    tunnel: {
      region: 'auto',
      autostart: false,
    },
    allowRemoteLogin: true,
    tunnelProviders: {},
    telephony: {
      activeProviderId: null,
      inboundEnabled: false,
      outboundEnabled: false,
      defaultMissionId: null,
      recording: 'off',
      aiDisclosure: 'required',
      maxDurationSeconds: 600,
      maxConcurrentCalls: 1,
      providers: {},
    },
  };
}

export function mergeHostConfig(
  existing?: HostConfig | null,
  incoming?: HostConfig | null,
): HostConfig {
  const base = defaultHostConfig();
  if (!existing && !incoming) return base;

  const tunnelProviders: Record<string, TunnelProviderConfig> = {
    ...(base.tunnelProviders ?? {}),
    ...(existing?.tunnelProviders ?? {}),
  };
  for (const [id, cfg] of Object.entries(incoming?.tunnelProviders ?? {})) {
    const prev = tunnelProviders[id] ?? {};
    const mergedCreds: TunnelProviderCredentials = { ...prev.credentials };
    for (const [key, value] of Object.entries(cfg.credentials ?? {})) {
      // Never let an explicit `undefined` from a redacted client payload wipe a secret.
      if (value !== undefined) {
        (mergedCreds as Record<string, unknown>)[key] = value;
      }
    }
    tunnelProviders[id] = {
      ...prev,
      ...cfg,
      credentials: mergedCreds,
    };
  }

  return {
    ...base,
    ...existing,
    ...incoming,
    exposure: {
      ...base.exposure!,
      ...existing?.exposure,
      ...incoming?.exposure,
    },
    sessionPolicy: {
      ...base.sessionPolicy!,
      ...existing?.sessionPolicy,
      ...incoming?.sessionPolicy,
    },
    tunnel: {
      ...base.tunnel!,
      ...existing?.tunnel,
      ...incoming?.tunnel,
    },
    tunnelProviders,
    telephony: {
      ...base.telephony!,
      ...existing?.telephony,
      ...incoming?.telephony,
      providers: {
        ...(base.telephony?.providers ?? {}),
        ...(existing?.telephony?.providers ?? {}),
        ...(incoming?.telephony?.providers ?? {}),
      },
    },
  };
}
