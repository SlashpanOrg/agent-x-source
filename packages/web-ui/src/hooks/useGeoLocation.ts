import { useClientSituationOptional } from '../context/ClientSituationProvider';

export interface UseGeoLocationResult {
  cityLabel: string;
  fullLabel: string;
  resolved: boolean;
  loading: boolean;
  vpnSuspected: boolean;
  refresh: () => Promise<void>;
}

/** City display for footer/docking — hidden when location is not available. */
export function useGeoLocation(): UseGeoLocationResult {
  const ctx = useClientSituationOptional();
  return {
    cityLabel: ctx?.cityLabel ?? '',
    fullLabel: ctx?.fullLabel ?? '',
    resolved: Boolean(ctx?.locationKnown),
    loading: ctx?.loading ?? false,
    vpnSuspected: false,
    refresh: async () => { await ctx?.refreshFromServer(); },
  };
}
