/**
 * Prime Agent adoption feature resolution.
 * Capabilities are enabled by code defaults and per-turn policy — not user settings toggles.
 */
import type { AgentXConfig } from './types/config.js';
import type { AdoptionSettings } from './types/adoption-settings.js';

export interface AdoptionFeatureFlags {
  harness: boolean;
  goals: boolean;
  qualityGates: boolean;
  durableTurns: boolean;
  wsGenerationReplay: boolean;
  sessionLease: boolean;
  subagentAdmission: boolean;
  interAgentMessaging: boolean;
  executableSkills: boolean;
  residentSessions: boolean;
}

/** Code defaults — all adoption surfaces available; per-turn policy narrows when needed. */
export const DEFAULT_ADOPTION_SETTINGS: AdoptionSettings = {
  harness: { enabled: true, autoRefineOnCompaction: true, autoRefineIntervalTurns: 3 },
  goals: { enabled: true },
  qualityGates: { enabled: true },
  durableTurns: { enabled: true },
  wsGenerationReplay: { enabled: true },
  sessionLease: { enabled: true },
  subagentAdmission: { enabled: true },
  interAgentMessaging: { enabled: true },
  executableSkills: { enabled: true },
  residentSessions: { enabled: true },
};

let activeSettings: AdoptionSettings = { ...DEFAULT_ADOPTION_SETTINGS };
let turnOverrides: AdoptionFeatureFlags | null = null;

function flag(settings: AdoptionSettings, key: keyof AdoptionSettings, defaultEnabled: boolean): boolean {
  const toggle = settings[key];
  if (toggle?.enabled === undefined) return defaultEnabled;
  return toggle.enabled;
}

function toFlags(settings: AdoptionSettings): AdoptionFeatureFlags {
  return {
    harness: flag(settings, 'harness', DEFAULT_ADOPTION_SETTINGS.harness?.enabled ?? true),
    goals: flag(settings, 'goals', DEFAULT_ADOPTION_SETTINGS.goals?.enabled ?? true),
    qualityGates: flag(settings, 'qualityGates', DEFAULT_ADOPTION_SETTINGS.qualityGates?.enabled ?? true),
    durableTurns: flag(settings, 'durableTurns', DEFAULT_ADOPTION_SETTINGS.durableTurns?.enabled ?? true),
    wsGenerationReplay: flag(settings, 'wsGenerationReplay', DEFAULT_ADOPTION_SETTINGS.wsGenerationReplay?.enabled ?? true),
    sessionLease: flag(settings, 'sessionLease', DEFAULT_ADOPTION_SETTINGS.sessionLease?.enabled ?? true),
    subagentAdmission: flag(settings, 'subagentAdmission', DEFAULT_ADOPTION_SETTINGS.subagentAdmission?.enabled ?? true),
    interAgentMessaging: flag(settings, 'interAgentMessaging', DEFAULT_ADOPTION_SETTINGS.interAgentMessaging?.enabled ?? true),
    executableSkills: flag(settings, 'executableSkills', DEFAULT_ADOPTION_SETTINGS.executableSkills?.enabled ?? true),
    residentSessions: flag(settings, 'residentSessions', DEFAULT_ADOPTION_SETTINGS.residentSessions?.enabled ?? true),
  };
}

/** Strip user `enabled` flags — adoption is agent-driven, not settings toggles. */
function stripUserEnabledFlags(patch: AdoptionSettings): AdoptionSettings {
  const out: AdoptionSettings = {};
  for (const key of Object.keys(patch) as Array<keyof AdoptionSettings>) {
    const entry = patch[key];
    if (!entry) continue;
    const { enabled: _enabled, ...rest } = entry as AdoptionSettings[keyof AdoptionSettings] & { enabled?: boolean };
    if (Object.keys(rest).length > 0) {
      out[key] = rest as AdoptionSettings[keyof AdoptionSettings];
    }
  }
  return out;
}

/** Merge persisted config over code defaults (ignores user enabled toggles). */
export function mergeAdoptionSettings(
  base: AdoptionSettings,
  patch?: AdoptionSettings | null,
): AdoptionSettings {
  if (!patch) return { ...base };
  const keys = Object.keys(DEFAULT_ADOPTION_SETTINGS) as Array<keyof AdoptionSettings>;
  const sanitized = stripUserEnabledFlags(patch);
  const out: AdoptionSettings = { ...base };
  for (const key of keys) {
    const prev = out[key];
    const next = sanitized[key];
    if (!next) continue;
    out[key] = { ...prev, ...next, enabled: prev?.enabled ?? true };
  }
  return out;
}

/** Apply adoption settings from loaded config (call on boot). User toggles are not applied. */
export function configureAdoptionFromConfig(config: AgentXConfig | null | undefined): AdoptionFeatureFlags {
  activeSettings = mergeAdoptionSettings(DEFAULT_ADOPTION_SETTINGS, config?.adoption);
  turnOverrides = null;
  return getAdoptionFeatureFlags();
}

/** Per-turn overrides resolved from user prompt (see engine adoption-turn-policy). */
export function setAdoptionTurnOverrides(flags: Partial<AdoptionFeatureFlags> | null): void {
  if (!flags) {
    turnOverrides = null;
    return;
  }
  turnOverrides = { ...toFlags(activeSettings), ...flags };
}

export function getAdoptionSettings(): AdoptionSettings {
  return activeSettings;
}

export function getAdoptionFeatureFlags(): AdoptionFeatureFlags {
  const base = toFlags(activeSettings);
  return turnOverrides ? { ...base, ...turnOverrides } : base;
}

export function isHarnessEnabled(): boolean {
  return getAdoptionFeatureFlags().harness;
}

export function isGoalsEnabled(): boolean {
  return getAdoptionFeatureFlags().goals;
}

export function isQualityGatesEnabled(): boolean {
  return getAdoptionFeatureFlags().qualityGates;
}

export function isDurableTurnsEnabled(): boolean {
  return getAdoptionFeatureFlags().durableTurns;
}

export function isSessionLeaseEnabled(): boolean {
  return getAdoptionFeatureFlags().sessionLease;
}

export function isSubagentAdmissionEnabled(): boolean {
  return getAdoptionFeatureFlags().subagentAdmission;
}

export function isInterAgentMessagingEnabled(): boolean {
  return getAdoptionFeatureFlags().interAgentMessaging;
}

export function isExecutableSkillsEnabled(): boolean {
  return getAdoptionFeatureFlags().executableSkills;
}

export function isResidentSessionsEnabled(): boolean {
  return getAdoptionFeatureFlags().residentSessions;
}

export function isWsGenerationReplayEnabled(): boolean {
  return getAdoptionFeatureFlags().wsGenerationReplay;
}

export function getHarnessAutoRefineSettings(): {
  onCompaction: boolean;
  intervalTurns: number;
} {
  const harness = getAdoptionSettings().harness;
  return {
    onCompaction: harness?.autoRefineOnCompaction ?? false,
    intervalTurns: harness?.autoRefineIntervalTurns ?? 0,
  };
}

export function isHarnessMemoryFabricIngestEnabled(): boolean {
  const harness = getAdoptionSettings().harness;
  if (!isHarnessEnabled()) return false;
  return harness?.memoryFabricIngest === true;
}
