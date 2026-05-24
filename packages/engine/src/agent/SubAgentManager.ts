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
}

export class SubAgentManager {
  private agents: Map<string, SubAgentTask> = new Map();
  private eventBus: AgentEventBus;
  private provider: ProviderInterface | null = null;
  private config: AgentXConfig | null = null;
  private systemPrompt: string = '';

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

  /**
   * Spawn a sub-agent that will actually execute an LLM completion in the background.
   */
  spawn(instruction: string, tools: string[] = [], timeout = 60_000): SubAgentTask {
    const task: SubAgentTask = {
      id: generateId(),
      instruction,
      tools,
      timeout,
      status: 'pending',
      abortController: new AbortController(),
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
      if (this.systemPrompt) {
        messages.push({ role: 'system', content: this.systemPrompt });
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
}
