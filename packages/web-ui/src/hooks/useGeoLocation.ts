/**
 * useGeoLocation — hook for fetching server-side geolocation.
 *
 * Fetches city-level location from the Agent-X server (which resolves it
 * from the IP address). The server refreshes every 15 minutes automatically;
 * this hook polls the server on mount and on focus, and provides a manual
 * refresh function.
 *
 * Returns a city-only label for display, plus a full label for tooltips.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { geolocation, type GeoLocationResponse } from '../api';

const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export interface UseGeoLocationResult {
  /** City name only, e.g. "Chennai". Or "Location not found" if unavailable. */
  cityLabel: string;
  /** Full location: "City, Region, Country" — for tooltip on hover. */
  fullLabel: string;
  /** Whether location has been resolved yet. */
  resolved: boolean;
  /** Whether a request is in flight. */
  loading: boolean;
  /** VPN/proxy detected. */
  vpnSuspected: boolean;
  /** Manually refresh the location. */
  refresh: () => Promise<void>;
}

export function useGeoLocation(): UseGeoLocationResult {
  const [data, setData] = useState<GeoLocationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const refreshingRef = useRef(false);
  // Keep a ref to the latest data so fetchLocation doesn't depend on `data`
  // (which would recreate the callback on every state change and re-trigger
  // the mount/focus effect in an infinite loop).
  const dataRef = useRef<GeoLocationResponse | null>(null);
  useEffect(() => { dataRef.current = data; }, [data]);

  const fetchLocation = useCallback(async (silent = false) => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    if (!silent) setLoading(true);
    try {
      const result = await geolocation.get();
      setData(result);
    } catch {
      // If fetch fails, keep existing data or set "not found"
      if (!dataRef.current) {
        setData({
          city: null,
          fullLabel: null,
          cityLabel: 'Location not found',
          method: 'timezone_only',
          vpnSuspected: false,
          resolved: false,
        });
      }
    } finally {
      setLoading(false);
      refreshingRef.current = false;
    }
  }, []);

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setLoading(true);
    try {
      const result = await geolocation.refresh();
      if (result.ok) {
        setData(result);
      }
    } catch {
      // ignore — keep existing data
    } finally {
      setLoading(false);
      refreshingRef.current = false;
    }
  }, []);

  // Fetch on mount (silent — no loading spinner flash), then poll every 15 minutes.
  // The initial fetch is silent so the user sees "Location not found" immediately
  // instead of a tiny 8px spinner that looks blank. The value updates to the actual
  // city once the fetch completes. Only manual refresh() shows the loading spinner.
  useEffect(() => {
    void fetchLocation(true);
    const interval = setInterval(() => void fetchLocation(true), POLL_INTERVAL_MS);
    const onFocus = () => void fetchLocation(true);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchLocation]);

  return {
    cityLabel: data?.cityLabel ?? 'Location not found',
    fullLabel: data?.fullLabel ?? 'Location not found',
    resolved: data?.resolved ?? false,
    loading,
    vpnSuspected: data?.vpnSuspected ?? false,
    refresh,
  };
}
