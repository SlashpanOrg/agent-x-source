import type { ClientSituation } from '@agentx/shared';
import { isClientLocationKnown } from '@agentx/shared';
import { resolveClientCityAuto, readBrowserTimezone } from './utils/resolve-client-city.js';

type SnapshotGetter = () => ClientSituation | null;

let snapshotGetter: SnapshotGetter | null = null;

export function registerClientSituationSnapshot(getter: SnapshotGetter): void {
  snapshotGetter = getter;
}

function readSource(): ClientSituation['source'] {
  const agentx = (window as Window & { agentx?: { isDesktop?: boolean } }).agentx;
  return agentx?.isDesktop ? 'desktop' : 'browser';
}

function timezoneOnlySituation(): ClientSituation {
  return {
    clientNow: new Date().toISOString(),
    timezone: readBrowserTimezone(),
    source: readSource(),
  };
}

function cityToSituation(city: Awaited<ReturnType<typeof resolveClientCityAuto>>): ClientSituation {
  if (!city) return timezoneOnlySituation();
  return {
    clientNow: new Date().toISOString(),
    timezone: readBrowserTimezone(),
    source: readSource(),
    locationLabel: city.locationLabel,
    locationMethod: city.locationMethod,
    locationConfidence: city.locationConfidence,
    vpnSuspected: city.vpnSuspected,
    latitude: city.latitude,
    longitude: city.longitude,
    ...(city.accuracyMeters !== undefined ? { accuracyMeters: city.accuracyMeters } : {}),
  };
}

/**
 * Sync snapshot for voice session start — never waits on GPS/IP.
 * Includes coordinates only when already cached; otherwise timezone only.
 */
export function peekCachedClientSituation(): ClientSituation {
  const snap = snapshotGetter?.();
  if (!snap) return timezoneOnlySituation();
  const now: ClientSituation = {
    clientNow: new Date().toISOString(),
    timezone: snap.timezone || readBrowserTimezone(),
    source: snap.source || readSource(),
  };
  if (!isClientLocationKnown(snap)) return now;
  return { ...snap, ...now };
}

/** Collect client situation for chat/voice turns — uses provider snapshot when location is known. */
export async function collectClientSituation(): Promise<ClientSituation> {
  const snap = snapshotGetter?.();
  if (snap && isClientLocationKnown(snap)) {
    return {
      ...snap,
      clientNow: new Date().toISOString(),
      timezone: snap.timezone || readBrowserTimezone(),
    };
  }

  const auto = await resolveClientCityAuto();
  if (auto) {
    return cityToSituation(auto);
  }

  if (snap) {
    return {
      ...snap,
      clientNow: new Date().toISOString(),
      timezone: snap.timezone || readBrowserTimezone(),
    };
  }

  return timezoneOnlySituation();
}
