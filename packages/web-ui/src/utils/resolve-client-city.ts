/**
 * Client-side city resolution — free APIs only, no API keys.
 * GPS + reverse geocode first; IP consensus (ipapi.co + ipwho.is) second.
 * No timezone or nearest-city fallback — returns null when uncertain.
 */

import { reverseGeocodeCity } from './reverse-geocode.js';
import {
  isGeolocationSupported,
  readClientTimezone,
  requestGeolocationCoords,
} from './location-permission.js';

export interface ResolvedClientCity {
  locationLabel: string;
  city: string;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  locationMethod: 'gps' | 'ip';
  locationConfidence: 'high' | 'low';
  vpnSuspected: boolean;
}

const IP_TIMEOUT_MS = 8_000;

interface IpWhoPayload {
  success?: boolean;
  city?: string;
  region?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  security?: { vpn?: boolean; proxy?: boolean; tor?: boolean; hosting?: boolean };
}

interface IpApiCoPayload {
  city?: string;
  region?: string;
  country_name?: string;
  latitude?: number;
  longitude?: number;
  error?: boolean;
}

function normalizeCityName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildLabel(city: string, region?: string | null, country?: string | null): string {
  const parts = [city, region, country].filter((p) => p && p.trim());
  return parts.join(', ').slice(0, 256);
}

async function fetchIpWho(): Promise<{
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
  vpnSuspected: boolean;
} | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), IP_TIMEOUT_MS);
  try {
    const res = await fetch('https://ipwho.is/', {
      signal: controller.signal,
      credentials: 'omit',
    });
    if (!res.ok) return null;
    const data = await res.json() as IpWhoPayload;
    if (!data.success || !data.city?.trim()) return null;
    const vpnSuspected = Boolean(
      data.security?.vpn || data.security?.proxy || data.security?.tor || data.security?.hosting,
    );
    return {
      city: data.city.trim(),
      region: data.region?.trim() || null,
      country: data.country?.trim() || null,
      lat: typeof data.latitude === 'number' ? data.latitude : null,
      lon: typeof data.longitude === 'number' ? data.longitude : null,
      vpnSuspected,
    };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

async function fetchIpApiCo(): Promise<{
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
} | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), IP_TIMEOUT_MS);
  try {
    const res = await fetch('https://ipapi.co/json/', {
      signal: controller.signal,
      credentials: 'omit',
    });
    if (!res.ok) return null;
    const data = await res.json() as IpApiCoPayload;
    if (data.error || !data.city?.trim()) return null;
    return {
      city: data.city.trim(),
      region: data.region?.trim() || null,
      country: data.country_name?.trim() || null,
      lat: typeof data.latitude === 'number' ? data.latitude : null,
      lon: typeof data.longitude === 'number' ? data.longitude : null,
    };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

async function resolveFromIpConsensus(): Promise<ResolvedClientCity | null> {
  const [who, apiCo] = await Promise.all([fetchIpWho(), fetchIpApiCo()]);
  if (!who || !apiCo) return null;
  if (who.vpnSuspected) return null;
  if (normalizeCityName(who.city!) !== normalizeCityName(apiCo.city!)) return null;

  const label = buildLabel(who.city!, who.region ?? apiCo.region, who.country ?? apiCo.country);
  const lat = who.lat ?? apiCo.lat ?? undefined;
  const lon = who.lon ?? apiCo.lon ?? undefined;
  if (lat === undefined || lon === undefined) return null;

  return {
    locationLabel: label,
    city: who.city!,
    latitude: lat,
    longitude: lon,
    locationMethod: 'ip',
    locationConfidence: 'low',
    vpnSuspected: false,
  };
}

async function resolveFromGps(): Promise<ResolvedClientCity | null> {
  if (!isGeolocationSupported()) return null;
  const coords = await requestGeolocationCoords();
  if (!coords) return null;
  const geo = await reverseGeocodeCity(coords.latitude, coords.longitude);
  if (!geo) return null;
  return {
    locationLabel: geo.fullLabel,
    city: geo.city,
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracyMeters: coords.accuracyMeters,
    locationMethod: 'gps',
    locationConfidence: 'high',
    vpnSuspected: false,
  };
}

/** Best-effort city from the client device. Null when not confidently available. */
export async function resolveClientCityAuto(): Promise<ResolvedClientCity | null> {
  const gps = await resolveFromGps();
  if (gps) return gps;
  return resolveFromIpConsensus();
}

export function readBrowserTimezone(): string {
  return readClientTimezone();
}
