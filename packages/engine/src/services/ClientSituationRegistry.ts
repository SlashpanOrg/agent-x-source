import type { ClientSituation } from '@agentx/shared';

type ClientSituationSetter = (situation: ClientSituation) => void;
type ClientSituationGetter = () => ClientSituation | null;

let setter: ClientSituationSetter | null = null;
let getter: ClientSituationGetter | null = null;

export function registerClientSituationSetter(fn: ClientSituationSetter): void {
  setter = fn;
}

export function registerClientSituationGetter(fn: ClientSituationGetter): void {
  getter = fn;
}

export function pushClientSituation(situation: ClientSituation): boolean {
  if (!setter) return false;
  setter(situation);
  return true;
}

export function getRegisteredClientSituation(): ClientSituation | null {
  return getter?.() ?? null;
}
