/** Prime Agent adoption — harness behavioral options (not user-facing toggles). */

export interface AdoptionFeatureToggle {
  enabled?: boolean;
}

/** Harness auto-refine triggers (Phase 4). */
export interface AdoptionHarnessSettings extends AdoptionFeatureToggle {
  /** Run harness refine after context compaction completes. */
  autoRefineOnCompaction?: boolean;
  /** Run harness refine every N completed turns (0 = off). */
  autoRefineIntervalTurns?: number;
  /** When true, copy harness memory entries into MemoryFabric after refine. */
  memoryFabricIngest?: boolean;
}

export interface AdoptionSettings {
  harness?: AdoptionHarnessSettings;
  goals?: AdoptionFeatureToggle;
  qualityGates?: AdoptionFeatureToggle;
  durableTurns?: AdoptionFeatureToggle;
  wsGenerationReplay?: AdoptionFeatureToggle;
  sessionLease?: AdoptionFeatureToggle;
  subagentAdmission?: AdoptionFeatureToggle;
  interAgentMessaging?: AdoptionFeatureToggle;
  executableSkills?: AdoptionFeatureToggle;
  residentSessions?: AdoptionFeatureToggle;
}
