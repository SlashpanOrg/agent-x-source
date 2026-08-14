import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AgentXConfig, HostConfig } from '@agentx/shared';
import { bootstrapTelephonyAdapters, getTelephonyService } from '@agentx/engine';
import { getDataDir, getLogger } from '@agentx/shared';
import { recordHostEvent } from './audit.js';
import { tryGetHostGateway, initHostGateway } from './HostGateway.js';

function cleanShutdownMarkerPath(): string {
  return join(getDataDir(), 'host-state', 'clean-shutdown.marker');
}

/**
 * Write the "we shut down cleanly" marker. Call this from the graceful
 * shutdown path only — never on crash/kill -9, which is exactly the case
 * this marker exists to distinguish.
 */
export function writeHostCleanShutdownMarker(): void {
  try {
    const markerPath = cleanShutdownMarkerPath();
    mkdirSync(dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, JSON.stringify({ shutdownAt: new Date().toISOString() }));
  } catch (err) {
    getLogger().warn('HOST_SHUTDOWN_MARKER_WRITE_FAILED', 'Failed to write clean-shutdown marker', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Consume (check-then-delete) the clean-shutdown marker. Returns whether the
 * previous process exit was clean. The marker is always deleted immediately
 * so a mid-session crash after this call correctly reports "not clean" on
 * the next startup, until another graceful shutdown re-writes it.
 */
function consumeCleanShutdownMarker(): boolean {
  const markerPath = cleanShutdownMarkerPath();
  const hadCleanShutdown = existsSync(markerPath);
  if (hadCleanShutdown) {
    try {
      rmSync(markerPath, { force: true });
    } catch (err) {
      getLogger().warn('HOST_SHUTDOWN_MARKER_CLEAR_FAILED', 'Failed to clear clean-shutdown marker', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return hadCleanShutdown;
}

// Fail-closed check runs at most once per process — subsequent applyHostConfig
// calls (live config edits, post-login re-application) are explicit user/engine
// actions, not restarts, and should not be second-guessed.
let failClosedCheckDone = false;

/**
 * Enforce fail-closed startup semantics: if the persisted config says public
 * access was on but the previous process did not shut down cleanly (crash,
 * force-kill, power loss), refuse to trust that state — force `publicAccess`
 * off and require the operator to explicitly re-enable it. A clean shutdown
 * (graceful SIGTERM/SIGINT) writes the marker that allows the persisted value
 * to be honored again.
 */
function enforceFailClosedStartup(hostConfig: HostConfig): HostConfig {
  if (failClosedCheckDone) return hostConfig;
  failClosedCheckDone = true;

  const hadCleanShutdown = consumeCleanShutdownMarker();
  if (hostConfig.publicAccess && !hadCleanShutdown) {
    getLogger().warn(
      'HOST_FAIL_CLOSED_STARTUP',
      'Public access was enabled but the previous shutdown was not clean — forcing public access off',
    );
    recordHostEvent({
      category: 'startup',
      code: 'fail_closed_startup',
      message: 'Public access was enabled but the previous shutdown was not clean; forced off pending operator action.',
    });
    return { ...hostConfig, publicAccess: false };
  }
  return hostConfig;
}

/** Reset the one-shot fail-closed check (tests only). */
export function __resetFailClosedCheckForTests(): void {
  failClosedCheckDone = false;
}

/**
 * Apply host + telephony config to live gateways (mirrors applyChannelsConfig).
 */
export async function applyHostConfig(config?: AgentXConfig | null): Promise<void> {
  let hostConfig = config?.host;
  const gateway = tryGetHostGateway();
  if (gateway && hostConfig) {
    hostConfig = enforceFailClosedStartup(hostConfig);
    // Keep telephony concurrency fixed in code (single call at a time).
    if (hostConfig.telephony) {
      hostConfig = {
        ...hostConfig,
        telephony: { ...hostConfig.telephony, maxConcurrentCalls: 1 },
      };
    }
    gateway.applyConfig(hostConfig);
    // Resume tunnel after clean restart when operator left public access + autostart on.
    if (
      hostConfig.publicAccess &&
      hostConfig.tunnel?.autostart &&
      hostConfig.provider &&
      gateway.getTunnelStatus().state !== 'active'
    ) {
      void gateway.startTunnel(hostConfig.provider).catch((err) => {
        getLogger().warn('HOST_TUNNEL_AUTOSTART_FAILED', 'Failed to autostart tunnel after config apply', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  try {
    const telephony = getTelephonyService();
    if (hostConfig?.telephony) {
      telephony.applyConfig({ ...hostConfig.telephony, maxConcurrentCalls: 1 });
    }
  } catch (err) {
    getLogger().warn('HOST_TELEPHONY_APPLY_FAILED', 'Failed to apply telephony config', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function ensureHostAndTelephonyBootstrapped(options: {
  bindHost: string;
  bindPort: number;
}): void {
  bootstrapTelephonyAdapters({
    includeFake: process.env['NODE_ENV'] === 'test' || process.env['AGENTX_TELEPHONY_FAKE'] === '1',
  });
  if (!tryGetHostGateway()) {
    initHostGateway({
      bindHost: options.bindHost,
      bindPort: options.bindPort,
      includeFake: process.env['NODE_ENV'] === 'test' || process.env['AGENTX_HOST_FAKE_TUNNEL'] === '1',
    });
  }
}
