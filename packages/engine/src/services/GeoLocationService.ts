/**
 * GeoLocationService — server-side IP geolocation with periodic refresh.
 *
 * Resolves the user's geographic location (city-level) from their public IP
 * address. This runs in the Agent-X server process (web-api), NOT in the
 * browser renderer — Electron's `navigator.geolocation` requires a Google
 * API key that we don't ship, so server-side IP geolocation is the reliable
 * path for desktop apps.
 *
 * Pipeline:
 *   1. Fetch from ipwho.is (free, no API key, includes VPN/proxy detection)
 *   2. Fallback to ip-api.com if ipwho.is fails
 *   3. If both fail, use timezone-only fallback
 *
 * The service refreshes every 15 minutes and pushes the updated
 * `ClientSituation` to the engine + all agents via a callback.
 *
 * Written from scratch for Agent-X.
 */
import type { ClientSituation } from '@agentx/shared';
import { getLogger } from '@agentx/shared';

export interface GeoLocationResult {
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  vpnSuspected: boolean;
  /** Full label: "City, Region, Country" or best available. */
  fullLabel: string;
  /** Short label: just the city name, or "Location not found". */
  cityLabel: string;
  /** How the location was obtained. */
  method: 'ip' | 'timezone_only';
  /** Timestamp (ms) when this location was resolved. */
  resolvedAt: number;
}

interface IpWhoResponse {
  success?: boolean;
  city?: string;
  region?: string;
  country?: string;
  country_code?: string;
  latitude?: number;
  longitude?: number;
  timezone?: { id?: string };
  security?: { vpn?: boolean; proxy?: boolean; tor?: boolean; hosting?: boolean };
}

interface IpApiResponse {
  status?: string;
  city?: string;
  regionName?: string;
  region?: string;
  country?: string;
  countryCode?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
  proxy?: boolean;
  hosting?: boolean;
}

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const REQUEST_TIMEOUT_MS = 8_000;

export type GeoLocationUpdateCallback = (situation: ClientSituation | null) => void;

/**
 * Server-side geolocation service. Resolves location from IP address and
 * refreshes periodically. Notifies a callback on each update so the engine
 * can sync the location to all agents.
 */
export class GeoLocationService {
  private current: GeoLocationResult | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inflight: Promise<GeoLocationResult | null> | null = null;
  private readonly onUpdate: GeoLocationUpdateCallback;
  private readonly timezone: string;

  constructor(opts: { onUpdate: GeoLocationUpdateCallback; timezone?: string }) {
    this.onUpdate = opts.onUpdate;
    this.timezone = opts.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  /** Start the service — resolve immediately, then refresh every 15 minutes. */
  start(): void {
    if (this.timer) return; // already started
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
    getLogger().info('GEOLOCATION', `Service started — refreshing every ${REFRESH_INTERVAL_MS / 60000} minutes`);
  }

  /** Stop the periodic refresh. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Get the current resolved location (may be null if not yet resolved). */
  getCurrent(): GeoLocationResult | null {
    return this.current;
  }

  /** Force an immediate refresh (e.g. when the user clicks "retry"). */
  async refresh(): Promise<GeoLocationResult | null> {
    if (this.inflight) return this.inflight;
    this.inflight = this.resolveLocation();
    try {
      const result = await this.inflight;
      if (result) {
        this.current = result;
        const situation = this.toClientSituation(result);
        this.onUpdate(situation);
        getLogger().info('GEOLOCATION', `Resolved: ${result.fullLabel} (method=${result.method}, vpn=${result.vpnSuspected})`);
      } else {
        getLogger().warn('GEOLOCATION', 'Could not resolve location from IP');
        // Still notify with timezone-only fallback so agents have timezone context
        const fallback = this.timezoneOnlyResult();
        this.current = fallback;
        this.onUpdate(this.toClientSituation(fallback));
      }
      return result;
    } finally {
      this.inflight = null;
    }
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private async resolveLocation(): Promise<GeoLocationResult | null> {
    // Try ipwho.is first (better VPN detection, includes timezone object)
    const primary = await this.fetchIpWho();
    if (primary) return primary;

    // Fallback to ip-api.com
    const fallback = await this.fetchIpApi();
    if (fallback) return fallback;

    return null;
  }

  private async fetchIpWho(): Promise<GeoLocationResult | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch('https://ipwho.is/', {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const data = await res.json() as IpWhoResponse;
      if (!data.success) return null;

      const city = data.city ?? null;
      const region = data.region ?? null;
      const country = data.country ?? null;
      const countryCode = data.country_code ?? null;
      const lat = typeof data.latitude === 'number' ? data.latitude : null;
      const lon = typeof data.longitude === 'number' ? data.longitude : null;
      const ipTz = data.timezone?.id ?? null;
      const vpnSuspected = Boolean(
        data.security?.vpn || data.security?.proxy || data.security?.tor || data.security?.hosting
      );

      return this.buildResult({
        city, region, country, countryCode,
        latitude: lat, longitude: lon,
        timezone: ipTz,
        vpnSuspected,
        method: 'ip',
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchIpApi(): Promise<GeoLocationResult | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch('http://ip-api.com/json/?fields=status,city,regionName,region,country,countryCode,lat,lon,timezone,proxy,hosting', {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const data = await res.json() as IpApiResponse;
      if (data.status !== 'success') return null;

      const city = data.city ?? null;
      const region = data.regionName ?? data.region ?? null;
      const country = data.country ?? null;
      const countryCode = data.countryCode ?? null;
      const lat = typeof data.lat === 'number' ? data.lat : null;
      const lon = typeof data.lon === 'number' ? data.lon : null;
      const ipTz = data.timezone ?? null;
      const vpnSuspected = Boolean(data.proxy || data.hosting);

      return this.buildResult({
        city, region, country, countryCode,
        latitude: lat, longitude: lon,
        timezone: ipTz,
        vpnSuspected,
        method: 'ip',
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private buildResult(parts: {
    city: string | null;
    region: string | null;
    country: string | null;
    countryCode: string | null;
    latitude: number | null;
    longitude: number | null;
    timezone: string | null;
    vpnSuspected: boolean;
    method: 'ip' | 'timezone_only';
  }): GeoLocationResult {
    const fullParts = [parts.city, parts.region, parts.country].filter((p) => p && p.trim());
    const fullLabel = fullParts.join(', ').slice(0, 256) || 'Unknown';
    const cityLabel = parts.city?.trim() || 'Location not found';

    return {
      city: parts.city,
      region: parts.region,
      country: parts.country,
      countryCode: parts.countryCode,
      latitude: parts.latitude,
      longitude: parts.longitude,
      timezone: parts.timezone,
      vpnSuspected: parts.vpnSuspected,
      fullLabel,
      cityLabel,
      method: parts.method,
      resolvedAt: Date.now(),
    };
  }

  private timezoneOnlyResult(): GeoLocationResult {
    return {
      city: null,
      region: null,
      country: null,
      countryCode: null,
      latitude: null,
      longitude: null,
      timezone: this.timezone,
      vpnSuspected: false,
      fullLabel: `Timezone: ${this.timezone}`,
      cityLabel: 'Location not found',
      method: 'timezone_only',
      resolvedAt: Date.now(),
    };
  }

  private toClientSituation(result: GeoLocationResult): ClientSituation {
    const situation: ClientSituation = {
      clientNow: new Date().toISOString(),
      timezone: result.timezone ?? this.timezone,
      source: 'desktop',
      locationMethod: result.method,
      locationConfidence: result.method === 'ip' && !result.vpnSuspected ? 'low' : 'unknown',
      vpnSuspected: result.vpnSuspected,
    };
    if (result.fullLabel && result.fullLabel !== 'Unknown') {
      situation.locationLabel = result.fullLabel;
    }
    if (result.latitude !== null && result.longitude !== null) {
      situation.latitude = result.latitude;
      situation.longitude = result.longitude;
    }
    return situation;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────

let instance: GeoLocationService | null = null;

export function setGeoLocationServiceInstance(svc: GeoLocationService | null): void {
  instance = svc;
}

export function getGeoLocationService(): GeoLocationService | null {
  return instance;
}
