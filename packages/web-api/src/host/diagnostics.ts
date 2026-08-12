import { getTelephonyService } from '@agentx/engine';
import type { HostExposureState, SecurityPosture, TunnelLifecycleState } from '@agentx/shared';
import { listHostEvents, type HostAuditEvent } from './audit.js';
import { redactAddressesForRemote } from './discovery.js';
import { getHostGateway } from './HostGateway.js';

export interface DiagnosticBundle {
  generatedAt: string;
  host: {
    exposureState: HostExposureState;
    security: SecurityPosture;
    network: {
      bindHost: string;
      bindPort: number;
      addressCount: number;
      lanUrlCount: number;
      publicIpConfidence: string;
      natUncertainty: boolean;
    };
    tunnel: {
      providerId: string | null;
      state: TunnelLifecycleState;
      protocol: 'https' | 'http' | 'wss' | null;
      hasPublicUrl: boolean;
    };
  };
  telephony: {
    /** Active provider id only — never credentials/tokens. */
    activeProviderId: string | null;
    inboundEnabled: boolean;
  };
  recentEvents: HostAuditEvent[];
}

/**
 * Redacted snapshot suitable for support/diagnostics without leaking secrets:
 * no tunnel credentials, no telephony tokens, no raw network-interface names.
 */
export function buildDiagnosticBundle(): DiagnosticBundle {
  const gateway = getHostGateway();
  const status = gateway.getStatus();

  let activeProviderId: string | null = null;
  let inboundEnabled = false;
  try {
    const telConfig = getTelephonyService().getConfig();
    activeProviderId = telConfig.activeProviderId ?? null;
    inboundEnabled = Boolean(telConfig.inboundEnabled);
  } catch {
    // Telephony service not initialized yet — leave defaults.
  }

  return {
    generatedAt: new Date().toISOString(),
    host: {
      exposureState: status.exposureState,
      security: status.security,
      network: {
        bindHost: status.network.bindHost,
        bindPort: status.network.bindPort,
        addressCount: redactAddressesForRemote(status.network.addresses).length,
        lanUrlCount: status.network.lanUrls.length,
        publicIpConfidence: status.network.publicIpConfidence,
        natUncertainty: status.network.natUncertainty,
      },
      tunnel: {
        providerId: status.tunnel.providerId,
        state: status.tunnel.state,
        protocol: status.tunnel.protocol ?? null,
        hasPublicUrl: Boolean(status.tunnel.publicUrl),
      },
    },
    telephony: { activeProviderId, inboundEnabled },
    recentEvents: listHostEvents(50),
  };
}
