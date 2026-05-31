import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { EngineEvent, CompletionMessage, AgentXConfig } from '@agentx/shared';
import type { AgentEventBus } from '../EventBus.js';
import type { ProviderInterface } from '../providers/ProviderInterface.js';
import { generateId } from '@agentx/shared';

export interface SubAgentTask {
  id: string;
  instruction: string;
  tools: string[];
  timeout: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: string;
  startTime?: number;
  endTime?: number;
  abortController?: AbortController;
  workDir?: string;
}

export class SubAgentManager {
  private agents: Map<string, SubAgentTask> = new Map();
  private eventBus: AgentEventBus;
  private provider: ProviderInterface | null = null;
  private config: AgentXConfig | null = null;
  private systemPrompt: string = '';
  private sandboxEnabled = false;
  private tempDirs: Set<string> = new Set();

  constructor(eventBus: AgentEventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Attach a provider and config so sub-agents can make real LLM calls.
   */
  configure(provider: ProviderInterface, config: AgentXConfig, systemPrompt: string): void {
    this.provider = provider;
    this.config = config;
    this.systemPrompt = systemPrompt;
  }

  enableSandbox(enabled: boolean): void {
    this.sandboxEnabled = enabled;
  }

  private createWorkDir(): string | undefined {
    if (!this.sandboxEnabled) return undefined;
    const dir = join(tmpdir(), `agentx-sub-${generateId()}`);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.tempDirs.add(dir);
    return dir;
  }

  private cleanupWorkDir(dir: string): void {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    this.tempDirs.delete(dir);
  }

  /**
   * Spawn a sub-agent that will actually execute an LLM completion in the background.
   */
  spawn(instruction: string, tools: string[] = [], timeout = 60_000): SubAgentTask {
    const workDir = this.createWorkDir();
    const task: SubAgentTask = {
      id: generateId(),
      instruction,
      tools,
      timeout,
      status: 'pending',
      abortController: new AbortController(),
      workDir,
    };

    this.agents.set(task.id, task);
    this.eventBus.emit({
      type: 'agent_spawned',
      agentId: task.id,
      task: instruction,
      startTime: Date.now(),
    } as EngineEvent);

    // Start execution immediately in the background
    void this.execute(task);

    return task;
  }

  /**
   * Execute a sub-agent task — runs a real LLM completion.
   */
  private async execute(task: SubAgentTask): Promise<void> {
    if (!this.provider || !this.config) {
      this.fail(task.id, 'SubAgent not configured — no provider attached');
      return;
    }

    task.status = 'running';
    task.startTime = Date.now();
    this.eventBus.emit({
      type: 'agent_progress',
      agentId: task.id,
      status: 'running',
    } as EngineEvent);

    try {
      const messages: CompletionMessage[] = [];
      let systemContent = this.systemPrompt;
      if (task.workDir) {
        systemContent += `\n\nYou are running in an isolated workspace at: ${task.workDir}\nAll file operations are scoped to this directory.`;
      }
      if (systemContent) {
        messages.push({ role: 'system', content: systemContent });
      }
      messages.push({ role: 'user', content: task.instruction });

      const request = {
        messages,
        model: this.config.provider.activeModel,
        stream: true,
        maxTokens: 4096,
      };

      // Set up timeout
      const timeoutId = setTimeout(() => {
        task.abortController?.abort();
      }, task.timeout);

      let result = '';
      const stream = this.provider.complete(request);
      for await (const chunk of stream) {
        if (task.abortController?.signal.aborted) break;
        if (chunk.type === 'text_delta' && chunk.content) {
          result += chunk.content;
        }
      }
      clearTimeout(timeoutId);

      if (task.abortController?.signal.aborted && task.status === 'running') {
        this.fail(task.id, 'Timed out');
      } else {
        this.complete(task.id, result);
      }
    } catch (error) {
      this.fail(task.id, error instanceof Error ? error.message : 'Sub-agent execution failed');
    }
  }

  /**
   * Run multiple sub-agents in parallel and wait for all to complete.
   */
  spawnParallel(tasks: Array<{ instruction: string; tools?: string[] }>): SubAgentTask[] {
    return tasks.map((t) => this.spawn(t.instruction, t.tools ?? []));
  }

  complete(agentId: string, result: string): void {
    const task = this.agents.get(agentId);
    if (task) {
      task.status = 'completed';
      task.result = result;
      task.endTime = Date.now();
      const elapsed = task.endTime - (task.startTime ?? task.endTime);
      if (task.workDir) this.cleanupWorkDir(task.workDir);
      this.eventBus.emit({
        type: 'agent_complete',
        agentId,
        summary: result.slice(0, 200),
        elapsed,
      } as EngineEvent);
    }
  }

  fail(agentId: string, error: string): void {
    const task = this.agents.get(agentId);
    if (task) {
      task.status = 'failed';
      task.result = error;
      task.endTime = Date.now();
      if (task.workDir) this.cleanupWorkDir(task.workDir);
      this.eventBus.emit({
        type: 'agent_complete',
        agentId,
        summary: `Failed: ${error}`,
        elapsed: Date.now() - (task.startTime ?? Date.now()),
      } as EngineEvent);
    }
  }

  cancel(agentId: string): void {
    const task = this.agents.get(agentId);
    if (task && (task.status === 'pending' || task.status === 'running')) {
      task.status = 'cancelled';
      task.endTime = Date.now();
      task.abortController?.abort();
    }
  }

  cancelAll(): void {
    for (const task of this.agents.values()) {
      if (task.status === 'pending' || task.status === 'running') {
        task.status = 'cancelled';
        task.endTime = Date.now();
        task.abortController?.abort();
      }
    }
  }

  getRunning(): SubAgentTask[] {
    return [...this.agents.values()].filter((t) => t.status === 'running');
  }

  getAll(): SubAgentTask[] {
    return [...this.agents.values()];
  }

  /**
   * Wait for all currently running agents to finish.
   */
  awaitAll(): Promise<SubAgentTask[]> {
    return new Promise((resolve) => {
      const check = () => {
        const running = this.getRunning();
        if (running.length === 0) {
          resolve(this.getAll());
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  /**
   * Get completed tasks (with results).
   */
  getCompleted(): SubAgentTask[] {
    return [...this.agents.values()].filter((t) => t.status === 'completed');
  }

  /**
   * Merge multiple sub-agent results into a single consolidated string.
   * Uses LLM for intelligent merging when provider is available, otherwise
   * falls back to simple concatenation with headers.
   */
  async mergeResults(taskIds?: string[]): Promise<string> {
    const tasks = taskIds
      ? taskIds.map((id) => this.agents.get(id)).filter((t): t is SubAgentTask => t !== undefined)
      : this.getCompleted();

    if (tasks.length === 0) return 'No completed sub-agent results to merge.';
    if (tasks.length === 1) return tasks[0]!.result ?? '(empty result)';

    // Try LLM-based merging
    if (this.provider && this.config) {
      const parts = tasks.map((t, i) => `--- Task ${i + 1}: ${t.instruction} ---\n${t.result ?? '(empty)'}`);
      const mergePrompt = `Consolidate the following parallel research/analysis results into a single coherent summary. Remove redundancy, combine related information, and present it in a well-organized format. Do not include the "--- Task N ---" separators in your output.

${parts.join('\n\n')}

Consolidated summary:`;

      try {
        const messages: CompletionMessage[] = [
          { role: 'user', content: mergePrompt },
        ];
        const stream = this.provider.complete({
          messages,
          model: this.config.provider.activeModel,
          maxTokens: 4096,
          stream: true,
        });
        let merged = '';
        for await (const chunk of stream) {
          if (chunk.type === 'text_delta' && chunk.content) {
            merged += chunk.content;
          }
        }
        return merged.trim() || tasks.map((t, i) =>
          `--- Result ${i + 1}: ${t.instruction} ---\n${t.result ?? '(empty)'}`
        ).join('\n\n');
      } catch {
        // Fall through to concatenation
      }
    }

    // Simple concatenation fallback
    return tasks.map((t, i) =>
      `--- Result ${i + 1}: ${t.instruction} ---\n${t.result ?? '(empty)'}`
    ).join('\n\n');
  }
}
