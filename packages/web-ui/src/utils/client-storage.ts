/**
 * Browser persistence scoped to Agent-X (localStorage + sessionStorage).
 * Keys use the `agentx_` prefix so a fresh install can wipe all client state at once.
 */

export const AGENTX_CLIENT_STORAGE_PREFIX = 'agentx_';
export const AGENTX_AUTH_TOKEN_KEY = 'agentx_auth_token';
export const AGENTX_DEV_MODE_KEY = 'agentx_dev_mode';
export const AGENTX_DEV_VERIFIED_KEY = 'agentx_dev_verified';

function collectPrefixedKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(AGENTX_CLIENT_STORAGE_PREFIX)) {
      keys.push(key);
    }
  }
  return keys;
}

function removePrefixedKeys(storage: Storage): string[] {
  const removed: string[] = [];
  for (const key of collectPrefixedKeys(storage)) {
    try {
      storage.removeItem(key);
      removed.push(key);
    } catch {
      /* private mode / quota */
    }
  }
  return removed;
}

/** Remove every Agent-X key from localStorage and sessionStorage. */
export function clearAgentxClientStorage(): string[] {
  return [
    ...removePrefixedKeys(localStorage),
    ...removePrefixedKeys(sessionStorage),
  ];
}

// ── Developer Mode state (§10.4) ─────────────────────────────────────────────
// Persisted in localStorage so the UI knows whether to show the "Open
// Observability" action and whether to show the verify screen. The server
// is the source of truth (via GET /api/observability/dev/status); these
// helpers are a client-side cache for fast initial render.

/** Returns true if developer mode is enabled (cached client-side). */
export function getDevMode(): boolean {
  try {
    return localStorage.getItem(AGENTX_DEV_MODE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Cache the developer-mode enabled state. */
export function setDevMode(enabled: boolean): void {
  try {
    localStorage.setItem(AGENTX_DEV_MODE_KEY, enabled ? 'true' : 'false');
  } catch { /* private mode / quota */ }
}

/** Returns true if the root password has been verified (cached client-side). */
export function getDevVerified(): boolean {
  try {
    return localStorage.getItem(AGENTX_DEV_VERIFIED_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Cache the dev-verified state. */
export function setDevVerified(verified: boolean): void {
  try {
    localStorage.setItem(AGENTX_DEV_VERIFIED_KEY, verified ? 'true' : 'false');
  } catch { /* private mode / quota */ }
}
