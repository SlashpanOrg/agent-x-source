/**
 * Global observability UI context (§11.2).
 *
 * Shared state across all pillars (Traces/Logs/Metrics):
 *   - Time range (last 5m/15m/1h/6h/24h/7d/custom) — preserved when switching pillars.
 *   - Auto-refresh (off/5s/10s/30s/1m) — applies to the current view.
 *   - Domain toggle (Agent/App/Both) — filters all pillars; persisted in URL + client storage.
 */
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { getDevMode, setDevMode as persistDevMode } from '../utils/client-storage';

export type DomainFilter = 'agent' | 'app' | 'both';
export type TimeRangePreset = '5m' | '15m' | '1h' | '6h' | '24h' | '7d' | 'custom';
export type RefreshInterval = 'off' | '5s' | '10s' | '30s' | '1m';

export interface TimeRange {
  preset: TimeRangePreset;
  from: string; // ISO timestamp
  to: string;   // ISO timestamp
}

export interface ObsContextValue {
  // Domain
  domain: DomainFilter;
  setDomain: (d: DomainFilter) => void;
  // Time range
  timeRange: TimeRange;
  setTimeRange: (tr: TimeRange) => void;
  // Refresh
  refreshInterval: RefreshInterval;
  setRefreshInterval: (i: RefreshInterval) => void;
  /** A counter that increments on each refresh tick — views watch this to re-fetch. */
  refreshTick: number;
  /** Manually trigger a refresh now. */
  triggerRefresh: () => void;
  // Dev mode (client-side cache; server is source of truth)
  devMode: boolean;
  setDevModeState: (enabled: boolean) => void;
}

const Ctx = createContext<ObsContextValue | null>(null);

function presetToRange(preset: TimeRangePreset, customFrom?: string, customTo?: string): TimeRange {
  if (preset === 'custom' && customFrom && customTo) {
    return { preset, from: customFrom, to: customTo };
  }
  const now = Date.now();
  const to = new Date(now).toISOString();
  const presets: Record<Exclude<TimeRangePreset, 'custom'>, number> = {
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  };
  const ms = presets[preset as Exclude<TimeRangePreset, 'custom'>] ?? 60 * 60 * 1000;
  return { preset, from: new Date(now - ms).toISOString(), to };
}

function domainFromUrl(): DomainFilter {
  try {
    const params = new URLSearchParams(window.location.search);
    const d = params.get('domain');
    if (d === 'agent' || d === 'app' || d === 'both') return d;
  } catch { /* ignore */ }
  return 'both';
}

function domainToUrl(d: DomainFilter): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('domain', d);
    window.history.replaceState({}, '', url.toString());
  } catch { /* ignore */ }
}

export function ObservabilityProvider({ children }: { children: ReactNode }): ReactNode {
  const [domain, setDomainState] = useState<DomainFilter>(() => domainFromUrl());
  const [timeRange, setTimeRange] = useState<TimeRange>(() => presetToRange('1h'));
  const [refreshInterval, setRefreshInterval] = useState<RefreshInterval>('off');
  const [refreshTick, setRefreshTick] = useState(0);
  const [devMode, setDevModeState] = useState<boolean>(() => getDevMode());

  const setDomain = useCallback((d: DomainFilter) => {
    setDomainState(d);
    domainToUrl(d);
  }, []);

  const setDevMode = useCallback((enabled: boolean) => {
    setDevModeState(enabled);
    persistDevMode(enabled);
  }, []);

  const triggerRefresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  // Auto-refresh timer.
  useEffect(() => {
    if (refreshInterval === 'off') return;
    const ms = { '5s': 5000, '10s': 10000, '30s': 30000, '1m': 60000 }[refreshInterval];
    const timer = setInterval(() => setRefreshTick((t) => t + 1), ms);
    return () => clearInterval(timer);
  }, [refreshInterval]);

  // On every refresh tick, slide non-custom time ranges forward to "now".
  useEffect(() => {
    if (timeRange.preset !== 'custom') {
      setTimeRange(presetToRange(timeRange.preset));
    }
  }, [refreshTick, timeRange.preset]);

  // When preset changes (non-custom), recompute the range.
  useEffect(() => {
    if (timeRange.preset !== 'custom') {
      setTimeRange(presetToRange(timeRange.preset));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRange.preset]);

  const value: ObsContextValue = {
    domain,
    setDomain,
    timeRange,
    setTimeRange,
    refreshInterval,
    setRefreshInterval,
    refreshTick,
    triggerRefresh,
    devMode,
    setDevModeState: setDevMode,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useObs(): ObsContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useObs must be used within ObservabilityProvider');
  return ctx;
}
