import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentXConfig, Message } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { Agent } from '../agent/Agent.js';
import { createDefaultToolkit } from '../tools/toolkit.js';
import { EnhancedToolExecutor } from '../tools/EnhancedToolExecutor.js';
import {
  DEFAULT_FIXTURES,
} from './benchmark/default-fixtures.js';
import type {
  BenchmarkAssertion,
  BenchmarkFixture,
  PromptBenchmarkProgressEvent,
  PromptBenchmarkRunResult,
  BenchmarkToolCall,
  BenchmarkTurnResult,
} from './benchmark/types.js';

const logger = getLogger();

/** Delay (ms) between fixtures to avoid provider rate limits. */
const INTER_FIXTURE_DELAY_MS = 3000;
/** Maximum retries for a single fixture when rate-limited. */
const MAX_RATE_LIMIT_RETRIES = 4;
/** Base backoff (ms) for rate-limit retries — doubles each retry. */
const RATE_LIMIT_BACKOFF_BASE_MS = 10000;
/** Initial delay (ms) before the first fixture, to allow rate limits to reset. */
const INITIAL_COOLDOWN_MS = 5000;

/** Detect rate-limit / quota errors from error messages. */
function isRateLimitError(msg: string): boolean {
  return /429|rate.?limit|too many requests|quota|overloaded|throttl/i.test(msg);
}

/** Detect canned/fallback error messages that indicate no real LLM call happened. */
const CANNED_RESPONSE_MARKERS = [
  'I was unable to generate a response',
  'This model may not support function calling',
  'I could not generate a reply',
  'I ran tools but could not finish',
];
function isCannedResponse(content: string): boolean {
  return CANNED_RESPONSE_MARKERS.some((m) => content.includes(m));
}

/**
 * Determine if a benchmark turn result represents a real LLM response vs a
 * failed/canned/rate-limited response. Real responses have substantial output
 * tokens and don't match canned error messages.
 */
function isRealResponse(result: BenchmarkTurnResult): boolean {
  if (result.toolCalls.length > 0) return true;
  if (isCannedResponse(result.assistantContent)) return false;
  // Real LLM responses produce at least ~100 output tokens; canned/error
  // responses are typically <50 output tokens.
  if (result.outputTokens < 100) return false;
  return result.assistantContent.length > 50;
}

/** Sleep helper that respects abort signals. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Aborted'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Aborted')); }, { once: true });
  });
}

export interface BenchmarkRunOptions {
  /** Optional run id; generated if omitted. */
  runId?: string;
  workspace: string;
  fixtures: BenchmarkFixture[];
  config: AgentXConfig;
  modelId: string;
  onProgress?: (event: PromptBenchmarkProgressEvent) => void;
  /** Abort signal to cancel mid-run. */
  signal?: AbortSignal;
  /** Delay between fixtures in ms (default: 2000). Set to 0 to disable. */
  interFixtureDelayMs?: number;
}

export class PromptBenchmarkService {
  /** Abort signal for the current run (set by run()). */
  private abortSignal?: AbortSignal;
  /**
   * Load benchmark fixtures from a JSON file path.
   * Fixtures may be a single object or an array.
   */
  loadFixtures(filePath: string): BenchmarkFixture[] {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
    const fixtures = Array.isArray(raw) ? raw : [raw];
    for (const f of fixtures) {
      if (!f.id || !f.category || !f.user || !f.expected) {
        throw new Error(`Invalid fixture: ${JSON.stringify(f)}`);
      }
    }
    return fixtures as BenchmarkFixture[];
  }

  getDefaultFixtures(): BenchmarkFixture[] {
    return DEFAULT_FIXTURES.map((f) => ({ ...f }));
  }

  /**
   * Spawn an isolated benchmark Agent with all tool permissions bypassed.
   */
  private createBenchmarkAgent(config: AgentXConfig, scopePath: string, sessionId: string): Agent {
    const toolkit = createDefaultToolkit(scopePath);
    const toolExecutor = new EnhancedToolExecutor(toolkit.registry, scopePath);
    for (const [name, handler] of toolkit.executor.getHandlers()) {
      toolExecutor.registerHandler(name, handler);
    }
    // Bypass all permission prompts for measurement
    toolExecutor.getPermissionManager().setBypassPermissions(true);
    toolExecutor.setAlwaysPromptPermissions(false);

    const agent = new Agent({
      config,
      sessionId,
      scopePath,
      toolExecutor,
      toolRegistry: toolkit.registry,
      // Do not run git auto-commit in benchmarks
      gitAutoCommit: false,
      gitAware: false,
      skipEmptyResponseRetry: true,
    });

    // Remove integration guard policies so the benchmark can measure full tool availability
    toolExecutor.setThirdPartyTurnPolicy(null);
    toolExecutor.setKbDocumentTurnPolicy(null);

    // Enable full permission bypass for the benchmark agent
    toolExecutor.getPermissionManager().setBypassPermissions(true);
    toolExecutor.setAlwaysPromptPermissions(false);
    agent.setBypassPermissions(true);

    return agent;
  }

  /**
   * Run the full benchmark suite and emit progress events.
   */
  async run(options: BenchmarkRunOptions): Promise<PromptBenchmarkRunResult> {
    const runId = options.runId ?? randomUUID();
    const startedAt = new Date().toISOString();
    const baseWorkspace = resolve(options.workspace);
    const runRoot = resolve(join(baseWorkspace, `benchmark-run-${runId}`));
    if (!existsSync(runRoot)) {
      mkdirSync(runRoot, { recursive: true });
    }
    this.abortSignal = options.signal;
    const interFixtureDelay = options.interFixtureDelayMs ?? INTER_FIXTURE_DELAY_MS;

    const result: PromptBenchmarkRunResult = {
      runId,
      modelId: options.modelId,
      workspace: runRoot,
      startedAt,
      totalTurns: options.fixtures.length,
      passed: 0,
      warned: 0,
      failed: 0,
      avgInputTokens: 0,
      avgOutputTokens: 0,
      avgTotalTokens: 0,
      avgLatencyMs: 0,
      turns: [],
    };

    const emit = (event: Omit<PromptBenchmarkProgressEvent, 'runId'>) => {
      options.onProgress?.({ ...event, runId } as PromptBenchmarkProgressEvent);
    };

    emit({ type: 'started', total: options.fixtures.length });

    // Initial cooldown to allow provider rate limits to reset from any prior runs
    if (INITIAL_COOLDOWN_MS > 0) {
      logger.info('BENCHMARK', `Waiting ${INITIAL_COOLDOWN_MS}ms before starting (rate-limit cooldown)`);
      await sleep(INITIAL_COOLDOWN_MS, options.signal);
    }

    let totalInput = 0;
    let totalOutput = 0;
    let totalLatency = 0;

    try {
      for (let i = 0; i < options.fixtures.length; i++) {
        if (options.signal?.aborted) {
          emit({ type: 'error', message: 'Benchmark aborted by user.' });
          break;
        }

        const fixture = options.fixtures[i]!;
        emit({ type: 'turn_start', current: i + 1, total: options.fixtures.length, fixtureId: fixture.id });

        const fixtureWorkspace = join(runRoot, fixture.id);
        mkdirSync(fixtureWorkspace, { recursive: true });
        if (fixture.setupFiles) {
          for (const [relPath, content] of Object.entries(fixture.setupFiles)) {
            const filePath = join(fixtureWorkspace, relPath);
            mkdirSync(dirname(filePath), { recursive: true });
            writeFileSync(filePath, content, 'utf-8');
          }
        }

        const sessionId = `benchmark-${runId}-${fixture.id}`;
        const agent = this.createBenchmarkAgent(options.config, fixtureWorkspace, sessionId);
        const turn = await this.runFixture(agent, fixture);

        result.turns.push(turn);
        if (turn.status === 'pass') result.passed++;
        else if (turn.status === 'warn') result.warned++;
        else result.failed++;

        totalInput += turn.inputTokens;
        totalOutput += turn.outputTokens;
        totalLatency += turn.latencyMs;

        emit({
          type: 'turn_complete',
          current: i + 1,
          total: options.fixtures.length,
          fixtureId: fixture.id,
          status: turn.status,
          notes: turn.notes,
        });

        // Inter-fixture delay to avoid provider rate limits
        if (interFixtureDelay > 0 && i < options.fixtures.length - 1) {
          await sleep(interFixtureDelay, options.signal);
        }
      }
    } finally {
      // Strict cleanup: remove every file and directory created by this benchmark run
      try { rmSync(runRoot, { recursive: true, force: true }); } catch { /* ignore cleanup errors */ }
    }

    const completedTurns = result.turns.length;
    result.avgInputTokens = completedTurns > 0 ? Math.round(totalInput / completedTurns) : 0;
    result.avgOutputTokens = completedTurns > 0 ? Math.round(totalOutput / completedTurns) : 0;
    result.avgTotalTokens = completedTurns > 0 ? Math.round((totalInput + totalOutput) / completedTurns) : 0;
    result.avgLatencyMs = completedTurns > 0 ? Math.round(totalLatency / completedTurns) : 0;
    result.completedAt = new Date().toISOString();

    emit({ type: 'complete', result });
    return result;
  }

  /**
   * Run a single fixture against an isolated agent, with rate-limit retry.
   */
  private async runFixture(agent: Agent, fixture: BenchmarkFixture): Promise<BenchmarkTurnResult> {
    let lastResult: BenchmarkTurnResult | null = null;
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
      if (this.abortSignal?.aborted) break;

      // Fresh agent per attempt — the previous one may be in a bad state
      const retryAgent = attempt === 0
        ? agent
        : this.createBenchmarkAgent(agent.config, agent.scopePath, `benchmark-retry-${fixture.id}-${attempt}`);

      try {
        lastResult = await this.runFixtureOnce(retryAgent, fixture);
        // If we got a real LLM response, accept it
        if (isRealResponse(lastResult)) {
          if (lastError) lastResult.notes.unshift(`Recovered after ${attempt} rate-limit retry(ies)`);
          return lastResult;
        }
        // Canned/empty/low-token response — likely rate limited or failed. Retry with backoff
        if (attempt < MAX_RATE_LIMIT_RETRIES) {
          const backoff = RATE_LIMIT_BACKOFF_BASE_MS * Math.pow(2, attempt);
          logger.warn('BENCHMARK_TURN', `Fixture ${fixture.id} returned no real LLM response (attempt ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES + 1}, ${lastResult.outputTokens} output tokens, ${lastResult.assistantContent.length} chars) — waiting ${backoff}ms before retry`);
          await sleep(backoff, this.abortSignal);
          continue;
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        if (isRateLimitError(lastError) && attempt < MAX_RATE_LIMIT_RETRIES) {
          const backoff = RATE_LIMIT_BACKOFF_BASE_MS * Math.pow(2, attempt);
          logger.warn('BENCHMARK_TURN', `Fixture ${fixture.id} rate-limited (attempt ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES + 1}) — waiting ${backoff}ms before retry`);
          await sleep(backoff, this.abortSignal);
          continue;
        }
        logger.error('BENCHMARK_TURN', `Fixture ${fixture.id} failed: ${lastError}`);
        break;
      }
    }

    // Return the last result or a synthetic failure
    if (lastResult) {
      if (lastError) lastResult.notes.unshift(`Turn error: ${lastError}`);
      return lastResult;
    }
    return {
      id: fixture.id,
      category: fixture.category,
      user: fixture.user,
      assistantContent: '',
      toolCalls: [],
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      latencyMs: 0,
      status: 'fail',
      notes: lastError ? [`Turn error: ${lastError}`] : ['All retries exhausted'],
    };
  }

  /**
   * Run a single fixture attempt against an agent (no retry).
   */
  private async runFixtureOnce(agent: Agent, fixture: BenchmarkFixture): Promise<BenchmarkTurnResult> {
    const start = Date.now();
    const tokenBeforeIn = agent.tokens.inputTokenCount;
    const tokenBeforeOut = agent.tokens.outputTokenCount;

    let message: Message | null = null;
    let error: string | undefined;

    try {
      const messages = fixture.conversation && fixture.conversation.length > 0
        ? fixture.conversation
        : [fixture.user];
      for (const userMessage of messages) {
        message = await agent.sendMessage(userMessage);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      logger.error('BENCHMARK_TURN', `Fixture ${fixture.id} failed: ${error}`);
    }

    const latencyMs = Date.now() - start;
    const tokenAfterIn = agent.tokens.inputTokenCount;
    const tokenAfterOut = agent.tokens.outputTokenCount;

    const assistantContent = message?.content ?? '';
    const rawToolCalls = agent.getToolExecutor()?.getExecutionHistory() ?? [];
    const toolCalls: BenchmarkToolCall[] = rawToolCalls.map((t) => ({
      id: `${t.toolId}-${t.timestamp}`,
      name: t.toolId,
      args: t.args,
      success: t.result.success,
      output: t.result.output,
      error: t.result.error,
      elapsed: t.elapsed,
    }));

    const inputTokens = Math.max(0, tokenAfterIn - tokenBeforeIn);
    const outputTokens = Math.max(0, tokenAfterOut - tokenBeforeOut);

    const notes: string[] = [];
    if (error) notes.push(`Turn error: ${error}`);

    const status = this.evaluateFixture(fixture, assistantContent, toolCalls, notes);

    return {
      id: fixture.id,
      category: fixture.category,
      user: fixture.user,
      assistantContent,
      toolCalls,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      latencyMs,
      status,
      notes,
    };
  }

  /**
   * Evaluate a fixture's expected outcome and update notes.
   */
  private evaluateFixture(
    fixture: BenchmarkFixture,
    assistantContent: string,
    toolCalls: BenchmarkToolCall[],
    notes: string[],
  ): 'pass' | 'fail' | 'warn' {
    const { expected } = fixture;
    let failed = false;

    // Category check (only once the detector is wired; otherwise skipped)
    if (expected.detectedCategory !== undefined) {
      // TODO: fill in with actual detected category once CategoryDetector is integrated
      notes.push(`Expected category ${expected.detectedCategory} — detector not wired yet`);
    }

    // Tool counts
    if (expected.minToolCalls !== undefined && toolCalls.length < expected.minToolCalls) {
      notes.push(`Expected ≥${expected.minToolCalls} tool calls, got ${toolCalls.length}`);
      failed = true;
    }
    if (expected.maxToolCalls !== undefined && toolCalls.length > expected.maxToolCalls) {
      notes.push(`Expected ≤${expected.maxToolCalls} tool calls, got ${toolCalls.length}`);
      failed = true;
    }

    // Required / banned tools
    const calledNames = new Set(toolCalls.map((t) => t.name));
    for (const name of expected.requiredTools ?? []) {
      if (!calledNames.has(name)) {
        notes.push(`Required tool ${name} was not called`);
        failed = true;
      }
    }
    for (const name of expected.bannedTools ?? []) {
      if (calledNames.has(name)) {
        notes.push(`Banned tool ${name} was called`);
        failed = true;
      }
    }

    // Assertions
    for (const assertion of expected.assertions ?? []) {
      const ok = this.evaluateAssertion(assertion, assistantContent, toolCalls);
      if (!ok) {
        notes.push(`Assertion failed: ${JSON.stringify(assertion)}`);
        failed = true;
      }
    }

    // If no hard failures but notes exist, downgrade to warn? For now any note is a warning.
    if (failed) return 'fail';
    if (notes.length > 0) return 'warn';
    return 'pass';
  }

  /**
   * Evaluate a single assertion.
   */
  private evaluateAssertion(
    assertion: BenchmarkAssertion,
    assistantContent: string,
    toolCalls: BenchmarkToolCall[],
  ): boolean {
    const haystack =
      assertion.in === 'toolCalls'
        ? toolCalls.map((t) => `${t.name}:${t.output}`).join('\n')
        : assistantContent;
    const normalize = (s: string) => s.replace(/[$,]/g, '');

    switch (assertion.type) {
      case 'contains':
        return typeof assertion.value === 'string' && normalize(haystack).includes(normalize(assertion.value));
      case 'notContains':
        return typeof assertion.value === 'string' && !normalize(haystack).includes(normalize(assertion.value));
      case 'minLength':
        return typeof assertion.value === 'number' && haystack.length >= assertion.value;
      case 'maxLength':
        return typeof assertion.value === 'number' && haystack.length <= assertion.value;
      case 'regex':
        return typeof assertion.value === 'string' && new RegExp(assertion.value, 'i').test(normalize(haystack));
      case 'toolCalled':
        return typeof assertion.toolName === 'string' && toolCalls.some((t) => t.name === assertion.toolName);
      case 'toolNotCalled':
        return typeof assertion.toolName === 'string' && !toolCalls.some((t) => t.name === assertion.toolName);
      case 'categoryIs':
        // Handled separately when detectedCategory is available
        return true;
      default:
        return false;
    }
  }
}
