/**
 * Turn Mode types — controls how much effort the agent puts into processing
 * a turn (Thinking Mode) and how verbose the response is (Output Mode).
 *
 * These are orthogonal axes:
 * - ThinkingMode controls tool usage, reasoning depth, RAG retrieval, web search
 * - OutputMode controls response length, format complexity, explanation depth
 */

/** How much processing effort the agent puts into a turn. */
export type ThinkingMode = 'light' | 'medium' | 'high';

/** How verbose and detailed the agent's response should be. */
export type OutputMode = 'brief' | 'moderate' | 'detailed';

/** Default modes for new sessions and when none is specified. */
export const DEFAULT_THINKING_MODE: ThinkingMode = 'medium';
export const DEFAULT_OUTPUT_MODE: OutputMode = 'moderate';

/** All valid thinking mode values (for validation). */
export const THINKING_MODES: ThinkingMode[] = ['light', 'medium', 'high'];

/** All valid output mode values (for validation). */
export const OUTPUT_MODES: OutputMode[] = ['brief', 'moderate', 'detailed'];

/** Human-readable labels for UI display. */
export const THINKING_MODE_LABELS: Record<ThinkingMode, string> = {
  light: 'Light',
  medium: 'Medium',
  high: 'High',
};

export const OUTPUT_MODE_LABELS: Record<OutputMode, string> = {
  brief: 'Brief',
  moderate: 'Moderate',
  detailed: 'Detailed',
};

/**
 * Tool call budget per thinking mode.
 * light = 3 tool calls, medium = ~50% of available tools, high = unlimited.
 * 0 = unlimited (use the 40-step safety net).
 * -1 = 50% of available tools (computed at runtime).
 */
export const THINKING_MODE_TOOL_BUDGET: Record<ThinkingMode, number> = {
  light: 3,
  medium: -1, // -1 = 50% of available tools (computed at runtime)
  high: 0,    // 0 = unlimited
};

/** Reasoning effort mapping per thinking mode. */
export const THINKING_MODE_REASONING_EFFORT: Record<ThinkingMode, 'none' | 'low' | 'medium' | 'high'> = {
  light: 'none',
  medium: 'medium',
  high: 'high',
};

/** Whether deep web search is allowed per thinking mode. */
export const THINKING_MODE_ALLOW_DEEP_SEARCH: Record<ThinkingMode, boolean> = {
  light: false,
  medium: true,
  high: true,
};

/** Whether RAG retrieval / reformulateQuery / extractMemories run per thinking mode. */
export const THINKING_MODE_SKIP_RETRIEVAL: Record<ThinkingMode, boolean> = {
  light: true,
  medium: false,
  high: false,
};

export const THINKING_MODE_SKIP_REFORMULATE: Record<ThinkingMode, boolean> = {
  light: true,
  medium: false,
  high: false,
};

export const THINKING_MODE_SKIP_EXTRACT_MEMORIES: Record<ThinkingMode, boolean> = {
  light: true,
  medium: false,
  high: false,
};

/** Max output token budget per output mode (0 = no output-mode cap — length is prompt-guided only). */
export const OUTPUT_MODE_MAX_TOKENS: Record<OutputMode, number> = {
  brief: 0,
  moderate: 0,
  detailed: 0,
};

/** Check if a value is a valid ThinkingMode. */
export function isValidThinkingMode(value: unknown): value is ThinkingMode {
  return typeof value === 'string' && THINKING_MODES.includes(value as ThinkingMode);
}

/** Check if a value is a valid OutputMode. */
export function isValidOutputMode(value: unknown): value is OutputMode {
  return typeof value === 'string' && OUTPUT_MODES.includes(value as OutputMode);
}
