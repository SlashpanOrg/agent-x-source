import type { ModelReasoningInfo, ReasoningEffortLevel } from '@agentx/shared';

/**
 * Command Code Provider API accepts only these `reasoning_effort` values.
 * Sending `none` / `minimal` (used elsewhere in Agent-X) yields HTTP 400.
 */
export const COMMANDCODE_REASONING_EFFORT_LEVELS: readonly ReasoningEffortLevel[] = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export const COMMANDCODE_DEFAULT_REASONING_EFFORT: ReasoningEffortLevel = 'low';

const ALLOWED = new Set<string>(COMMANDCODE_REASONING_EFFORT_LEVELS);

/**
 * Map Agent-X effort levels onto CommandCode's wire enum.
 * Returns `undefined` to omit the field (e.g. `none` / `minimal` / unknown).
 */
export function sanitizeCommandCodeReasoningEffort(
  effort: string | null | undefined,
): ReasoningEffortLevel | undefined {
  if (!effort) return undefined;
  const normalized = effort.trim().toLowerCase();
  if (!normalized || normalized === 'none' || normalized === 'minimal') {
    return undefined;
  }
  if (ALLOWED.has(normalized)) {
    return normalized as ReasoningEffortLevel;
  }
  return undefined;
}

/** Catalog reasoning controls for CommandCode models (provider-specific UI). */
export function resolveCommandCodeReasoningInfo(
  _modelId?: string,
): ModelReasoningInfo {
  return {
    supported: true,
    effortLevels: [...COMMANDCODE_REASONING_EFFORT_LEVELS],
    defaultEffort: COMMANDCODE_DEFAULT_REASONING_EFFORT,
    control: 'reasoning_effort',
  };
}

/** Benchmark / “minimal thinking” default when no UI selection is provided. */
export function commandCodeBenchmarkReasoningEffort(
  selected?: string | null,
): ReasoningEffortLevel | undefined {
  const fromUi = sanitizeCommandCodeReasoningEffort(selected);
  if (fromUi) return fromUi;
  // Prefer lowest valid effort for clearance scans (capability, not latency).
  return COMMANDCODE_DEFAULT_REASONING_EFFORT;
}

/**
 * AI SDK providerOptions for createOpenAICompatible({ name: 'commandcode' }).
 * Omits the field when effort is none/minimal/invalid.
 */
export function buildCommandCodeAiSdkProviderOptions(
  reasoningEffort?: ReasoningEffortLevel | string | null,
): { commandcode: { reasoningEffort: string } } | undefined {
  const sanitized = sanitizeCommandCodeReasoningEffort(reasoningEffort);
  if (!sanitized) return undefined;
  return { commandcode: { reasoningEffort: sanitized } };
}
