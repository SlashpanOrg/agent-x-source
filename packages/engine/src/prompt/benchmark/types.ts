import type { TurnCategory, TurnSubCategory } from '@agentx/shared';

/**
 * A single assertion to evaluate against one benchmark turn's result.
 */
export interface BenchmarkAssertion {
  type:
    | 'contains'
    | 'notContains'
    | 'minLength'
    | 'maxLength'
    | 'regex'
    | 'toolCalled'
    | 'toolNotCalled'
    | 'categoryIs';
  /** Where to look for string-based assertions. */
  in?: 'assistant' | 'output' | 'toolCalls';
  /** String or number value used by the assertion. */
  value?: string | number;
  /** Tool name for toolCalled / toolNotCalled assertions. */
  toolName?: string;
}

/**
 * Expected outcome for a benchmark fixture.
 */
export interface BenchmarkExpected {
  /** Expected primary category the detector should return. */
  detectedCategory?: TurnCategory;
  /** Expected sub-category label. */
  detectedSub?: TurnSubCategory;
  /** Minimum number of tool calls expected in the turn. */
  minToolCalls?: number;
  /** Maximum number of tool calls expected in the turn. */
  maxToolCalls?: number;
  /** Tool ids that must be called at least once. */
  requiredTools?: string[];
  /** Tool ids that must not be called. */
  bannedTools?: string[];
  /** Free-form assertions against the assistant output or tool calls. */
  assertions?: BenchmarkAssertion[];
}

/**
 * A preset benchmark turn.
 */
export interface BenchmarkFixture {
  /** Stable id, e.g. "coding-refactor". */
  id: string;
  /** The ground-truth category this turn belongs to. */
  category: TurnCategory;
  /** Optional sub-category label. */
  sub?: TurnSubCategory;
  /** Files to seed into the isolated fixture workspace before the turn. */
  setupFiles?: Record<string, string>;
  /** Multi-turn conversation messages. If omitted, `user` is sent as a single turn. */
  conversation?: string[];
  /** The user message sent to the agent (single-turn shorthand). */
  user: string;
  /** What the benchmark should verify. */
  expected: BenchmarkExpected;
}

/**
 * A normalized tool call captured from the agent's execution history.
 */
export interface BenchmarkToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  success: boolean;
  output: string;
  error?: string;
  elapsed: number;
}

/**
 * Result of a single benchmark turn.
 */
export interface BenchmarkTurnResult {
  id: string;
  category: TurnCategory;
  user: string;
  /** Category detected by the agent (optional until category detector is wired). */
  detectedCategory?: TurnCategory;
  /** Confidence reported by the detector. */
  detectedConfidence?: number;
  /** Final assistant message content. */
  assistantContent: string;
  /** Tool calls that actually executed. */
  toolCalls: BenchmarkToolCall[];
  /** Token usage for this turn (input + output, from the agent's TokenTracker). */
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Wall-clock time for the turn. */
  latencyMs: number;
  /** pass / fail / warn. */
  status: 'pass' | 'fail' | 'warn';
  /** Human-readable notes about failures or warnings. */
  notes: string[];
}

/**
 * Aggregated result of a full benchmark run.
 */
export interface PromptBenchmarkRunResult {
  /** Unique run id. */
  runId: string;
  /** Active model id used for the run. */
  modelId: string;
  /** Workspace folder the run executed against. */
  workspace: string;
  /** ISO timestamp when the run started. */
  startedAt: string;
  /** ISO timestamp when the run completed. */
  completedAt?: string;
  /** Total number of fixtures executed. */
  totalTurns: number;
  passed: number;
  warned: number;
  failed: number;
  /** Average input tokens per turn. */
  avgInputTokens: number;
  /** Average output tokens per turn. */
  avgOutputTokens: number;
  /** Average total tokens per turn. */
  avgTotalTokens: number;
  /** Average latency per turn in ms. */
  avgLatencyMs: number;
  /** Per-turn results. */
  turns: BenchmarkTurnResult[];
}

/**
 * Progress event streamed to the UI while a benchmark is running.
 */
export interface PromptBenchmarkProgressEvent {
  type: 'started' | 'turn_start' | 'turn_complete' | 'complete' | 'error';
  runId: string;
  /** 1-based index of the current turn. */
  current?: number;
  /** Total number of turns in this run. */
  total?: number;
  fixtureId?: string;
  status?: 'pass' | 'fail' | 'warn';
  notes?: string[];
  message?: string;
  result?: PromptBenchmarkRunResult;
}
