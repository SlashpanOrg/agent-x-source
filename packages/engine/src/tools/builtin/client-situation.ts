import type { ClientSituation, ToolResult } from '@agentx/shared';
import {
  getRegisteredClientSituation,
  pushClientSituation,
} from '../../services/ClientSituationRegistry.js';

function readLabel(args: Record<string, unknown>): string | null {
  const raw = args['location_label'] ?? args['locationLabel'] ?? args['location'] ?? args['city'];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, 256) : null;
}

/** Agent tool — save the user's stated city/place for UI and future turns. */
export async function setUserLocation(args: Record<string, unknown>): Promise<ToolResult> {
  const label = readLabel(args);
  if (!label) {
    return {
      success: false,
      output: 'location_label (or city) is required — e.g. "Chennai, Tamil Nadu, India".',
      error: 'MISSING_INPUT',
    };
  }

  const prev = getRegisteredClientSituation();
  const timezone = typeof args['timezone'] === 'string' && args['timezone'].trim()
    ? args['timezone'].trim()
    : prev?.timezone ?? 'UTC';

  const lat = typeof args['latitude'] === 'number' ? args['latitude'] : undefined;
  const lon = typeof args['longitude'] === 'number' ? args['longitude'] : undefined;

  const situation: ClientSituation = {
    clientNow: new Date().toISOString(),
    timezone,
    source: prev?.source ?? 'browser',
    locationLabel: label,
    locationMethod: 'user_set',
    locationConfidence: 'high',
    vpnSuspected: false,
    ...(lat !== undefined && lon !== undefined ? { latitude: lat, longitude: lon } : {}),
  };

  if (!pushClientSituation(situation)) {
    return {
      success: false,
      output: 'Could not persist user location on the server.',
      error: 'REGISTRY_MISSING',
    };
  }

  return {
    success: true,
    output: `User location saved as "${label}". The UI will update automatically.`,
  };
}
