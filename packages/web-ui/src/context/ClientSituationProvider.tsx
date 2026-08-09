import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ClientSituation } from '@agentx/shared';
import {
  clientLocationCityLabel,
  isClientLocationKnown,
} from '@agentx/shared';
import { clientSituation as clientSituationApi } from '../api';
import { registerClientSituationSnapshot } from '../client-situation';
import { resolveClientCityAuto, readBrowserTimezone } from '../utils/resolve-client-city';
import { subscribeTelemetry } from '../telemetry-hub';

export const CLIENT_SITUATION_UPDATED_EVENT = 'agentx:client-situation-updated';

function readSource(): ClientSituation['source'] {
  const agentx = (window as Window & { agentx?: { isDesktop?: boolean } }).agentx;
  return agentx?.isDesktop ? 'desktop' : 'browser';
}

function baseSituation(): ClientSituation {
  return {
    clientNow: new Date().toISOString(),
    timezone: readBrowserTimezone(),
    source: readSource(),
  };
}

function notifyUpdated(): void {
  window.dispatchEvent(new CustomEvent(CLIENT_SITUATION_UPDATED_EVENT));
}

export interface ClientSituationContextValue {
  situation: ClientSituation | null;
  locationKnown: boolean;
  cityLabel: string | null;
  fullLabel: string | null;
  loading: boolean;
  refreshFromServer: () => Promise<void>;
  applySituation: (situation: ClientSituation) => Promise<void>;
}

const ClientSituationContext = createContext<ClientSituationContextValue | null>(null);

export function useClientSituationContext(): ClientSituationContextValue {
  const ctx = useContext(ClientSituationContext);
  if (!ctx) {
    throw new Error('useClientSituationContext must be used within ClientSituationProvider');
  }
  return ctx;
}

export function useClientSituationOptional(): ClientSituationContextValue | null {
  return useContext(ClientSituationContext);
}

export function ClientSituationProvider({ children }: { children: ReactNode }) {
  const [situation, setSituation] = useState<ClientSituation | null>(null);
  const [loading, setLoading] = useState(true);
  const autoRanRef = useRef(false);

  const locationKnown = isClientLocationKnown(situation);
  const cityLabel = clientLocationCityLabel(situation);
  const fullLabel = locationKnown ? situation?.locationLabel ?? null : null;

  const applySituation = useCallback(async (next: ClientSituation) => {
    setSituation(next);
    try {
      await clientSituationApi.set(next);
    } catch {
      // keep local state even if sync fails
    }
    notifyUpdated();
  }, []);

  const refreshFromServer = useCallback(async () => {
    try {
      const { situation: remote } = await clientSituationApi.get();
      if (remote && isClientLocationKnown(remote)) {
        setSituation(remote);
        notifyUpdated();
      }
    } catch {
      // ignore
    }
  }, []);

  const runAutoDetect = useCallback(async () => {
    const city = await resolveClientCityAuto();
    if (!city) return;
    const next: ClientSituation = {
      ...baseSituation(),
      locationLabel: city.locationLabel,
      locationMethod: city.locationMethod,
      locationConfidence: city.locationConfidence,
      vpnSuspected: false,
      latitude: city.latitude,
      longitude: city.longitude,
      ...(city.accuracyMeters !== undefined ? { accuracyMeters: city.accuracyMeters } : {}),
    };
    await applySituation(next);
  }, [applySituation]);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      setLoading(true);
      try {
        const { situation: remote } = await clientSituationApi.get();
        if (cancelled) return;
        if (remote && isClientLocationKnown(remote)) {
          setSituation(remote);
          autoRanRef.current = true;
          return;
        }
        if (!autoRanRef.current) {
          autoRanRef.current = true;
          await runAutoDetect();
        } else {
          setSituation(remote ?? baseSituation());
        }
      } catch {
        if (!cancelled && !autoRanRef.current) {
          autoRanRef.current = true;
          await runAutoDetect();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void init();
    return () => { cancelled = true; };
  }, [runAutoDetect]);

  useEffect(() => {
    registerClientSituationSnapshot(() => situation);
    return () => registerClientSituationSnapshot(() => null);
  }, [situation]);

  useEffect(() => {
    const unsub = subscribeTelemetry((event) => {
      if (
        event.type === 'agent_action'
        && (event.metadata as { action?: string } | undefined)?.action === 'client_situation_updated'
      ) {
        void refreshFromServer();
      }
    });
    return unsub;
  }, [refreshFromServer]);

  useEffect(() => {
    const onFocus = () => { void refreshFromServer(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshFromServer]);

  const value = useMemo<ClientSituationContextValue>(() => ({
    situation,
    locationKnown,
    cityLabel,
    fullLabel,
    loading,
    refreshFromServer,
    applySituation,
  }), [situation, locationKnown, cityLabel, fullLabel, loading, refreshFromServer, applySituation]);

  return (
    <ClientSituationContext.Provider value={value}>
      {children}
    </ClientSituationContext.Provider>
  );
}
