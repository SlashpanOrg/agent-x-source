import { getLogger } from '@agentx/shared';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '@agentx/shared';

export type TaskPhase = 'exploring' | 'planning' | 'implementing' | 'verifying' | 'debugging' | 'complete';

export interface Subtask {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  createdAt: number;
  completedAt?: number;
}

export interface CompletionCriteria {
  description: string;
  met: boolean;
  checkedAt?: number;
}

export interface TaskState {
  taskDescription: string;
  category: string;
  sub?: string;
  phase: TaskPhase;
  startedAt: number;
  turns: number;
  filesRead: string[];
  filesWritten: string[];
  buildsRun: number;
  buildsPassed: number;
  buildsFailed: number;
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  errors: Array<{ turn: number; error: string; timestamp: number }>;
  toolsUsed: string[];
  subtasks: Subtask[];
  completionCriteria: CompletionCriteria[];
  taskId: string;
}

/** Valid phase transitions — prevents invalid jumps like complete → exploring */
const VALID_TRANSITIONS: Record<TaskPhase, TaskPhase[]> = {
  exploring: ['planning', 'implementing', 'complete'],
  planning: ['implementing', 'exploring', 'complete'],
  implementing: ['verifying', 'debugging', 'exploring', 'complete'],
  verifying: ['complete', 'debugging', 'implementing'],
  debugging: ['verifying', 'implementing', 'complete'],
  complete: [], // terminal — cannot transition out
};

/**
 * Task-level state that persists across turns within a session.
 *
 * Features:
 * - Phase tracking with validated transitions
 * - Subtask decomposition (add/update/complete subtasks)
 * - Completion criteria (explicit "done" checks)
 * - Checkpoint to disk (survives restart)
 * - Cross-turn file tracking (don't re-read files)
 * - Build-fix loop tracking
 */
export class TaskStateManager {
  private current: TaskState | null = null;
  private readonly maxBuildRetries = 3;
  private checkpointDir: string;

  constructor() {
    const configDir = getConfigDir();
    this.checkpointDir = join(configDir, 'task-state');
    try {
      if (!existsSync(this.checkpointDir)) mkdirSync(this.checkpointDir, { recursive: true });
    } catch {
      // Directory creation may fail in sandboxed environments
    }
  }

  startTask(description: string, category: string, sub?: string): TaskState {
    // If the new message is clearly a continuation, preserve state
    if (this.current && this.isContinuation(description, category)) {
      this.current.turns++;
      this.current.taskDescription = description;
      // Don't reset phase on continuation — keep the lifecycle going
      getLogger().info('TASK_STATE', `Continuing task (turn ${this.current.turns}): ${description.slice(0, 80)}`);
      this.checkpoint();
      return this.current;
    }

    // New task — checkpoint the old one if it exists
    if (this.current) {
      this.current.phase = 'complete';
      this.checkpoint();
    }

    this.current = {
      taskId: `task-${Date.now()}`,
      taskDescription: description,
      category,
      sub,
      phase: 'exploring',
      startedAt: Date.now(),
      turns: 1,
      filesRead: [],
      filesWritten: [],
      buildsRun: 0,
      buildsPassed: 0,
      buildsFailed: 0,
      testsRun: 0,
      testsPassed: 0,
      testsFailed: 0,
      errors: [],
      toolsUsed: [],
      subtasks: [],
      completionCriteria: [],
    };
    getLogger().info('TASK_STATE', `New task started: ${description.slice(0, 80)}`);
    this.checkpoint();
    return this.current;
  }

  getCurrent(): TaskState | null {
    return this.current;
  }

  setPhase(phase: TaskPhase): void {
    if (!this.current) return;
    const current = this.current.phase;
    if (current === phase) return;

    // Validate transition
    const allowed = VALID_TRANSITIONS[current];
    if (!allowed.includes(phase)) {
      getLogger().warn('TASK_STATE', `Invalid phase transition: ${current} → ${phase} (allowed: ${allowed.join(', ')})`);
      return;
    }

    getLogger().info('TASK_STATE', `Phase transition: ${current} → ${phase}`);
    this.current.phase = phase;
    this.checkpoint();
  }

  // ── Subtask management ──

  addSubtask(description: string): Subtask {
    if (!this.current) throw new Error('No active task');
    const subtask: Subtask = {
      id: `st-${this.current.subtasks.length + 1}`,
      description,
      status: 'pending',
      createdAt: Date.now(),
    };
    this.current.subtasks.push(subtask);
    this.checkpoint();
    return subtask;
  }

  startSubtask(id: string): void {
    if (!this.current) return;
    const st = this.current.subtasks.find((s) => s.id === id);
    if (st) {
      st.status = 'in_progress';
      this.checkpoint();
    }
  }

  completeSubtask(id: string): void {
    if (!this.current) return;
    const st = this.current.subtasks.find((s) => s.id === id);
    if (st) {
      st.status = 'completed';
      st.completedAt = Date.now();
      this.checkpoint();
      // Check if all subtasks are complete
      if (this.current.subtasks.length > 0 && this.current.subtasks.every((s) => s.status === 'completed')) {
        this.setPhase('verifying');
      }
    }
  }

  blockSubtask(id: string, reason?: string): void {
    if (!this.current) return;
    const st = this.current.subtasks.find((s) => s.id === id);
    if (st) {
      st.status = 'blocked';
      if (reason) getLogger().warn('TASK_STATE', `Subtask ${id} blocked: ${reason}`);
      this.checkpoint();
    }
  }

  getPendingSubtasks(): Subtask[] {
    return this.current?.subtasks.filter((s) => s.status === 'pending' || s.status === 'in_progress') ?? [];
  }

  // ── Completion criteria ──

  addCompletionCriteria(description: string): void {
    if (!this.current) return;
    this.current.completionCriteria.push({ description, met: false });
    this.checkpoint();
  }

  markCriterionMet(index: number): void {
    if (!this.current) return;
    const c = this.current.completionCriteria[index];
    if (c) {
      c.met = true;
      c.checkedAt = Date.now();
      this.checkpoint();
      // If all criteria are met, mark task complete
      if (this.current.completionCriteria.every((c) => c.met)) {
        this.setPhase('complete');
      }
    }
  }

  isComplete(): boolean {
    if (!this.current) return false;
    if (this.current.phase === 'complete') return true;
    // Auto-complete if all criteria are met and all subtasks are done
    if (this.current.completionCriteria.length > 0 && this.current.completionCriteria.every((c) => c.met)) {
      if (this.current.subtasks.length === 0 || this.current.subtasks.every((s) => s.status === 'completed')) {
        return true;
      }
    }
    return false;
  }

  // ── File / build / test tracking ──

  recordFileRead(path: string): void {
    if (!this.current) return;
    if (!this.current.filesRead.includes(path)) {
      this.current.filesRead.push(path);
    }
    if (this.current.phase === 'planning') this.setPhase('implementing');
  }

  recordFileWrite(path: string): void {
    if (!this.current) return;
    if (!this.current.filesWritten.includes(path)) {
      this.current.filesWritten.push(path);
    }
    this.setPhase('implementing');
  }

  recordBuild(success: boolean): void {
    if (!this.current) return;
    this.current.buildsRun++;
    if (success) {
      this.current.buildsPassed++;
      this.setPhase('verifying');
    } else {
      this.current.buildsFailed++;
      this.setPhase('debugging');
    }
    this.checkpoint();
  }

  recordTest(success: boolean): void {
    if (!this.current) return;
    this.current.testsRun++;
    if (success) {
      this.current.testsPassed++;
      this.setPhase('verifying');
    } else {
      this.current.testsFailed++;
      this.setPhase('debugging');
    }
    this.checkpoint();
  }

  recordError(error: string): void {
    if (!this.current) return;
    this.current.errors.push({
      turn: this.current.turns,
      error: error.slice(0, 500),
      timestamp: Date.now(),
    });
  }

  recordTool(toolId: string): void {
    if (!this.current) return;
    if (!this.current.toolsUsed.includes(toolId)) {
      this.current.toolsUsed.push(toolId);
    }
  }

  canRetryBuild(): boolean {
    if (!this.current) return false;
    return this.current.buildsFailed < this.maxBuildRetries;
  }

  hasReadFile(path: string): boolean {
    return this.current?.filesRead.includes(path) ?? false;
  }

  hasWrittenFile(path: string): boolean {
    return this.current?.filesWritten.includes(path) ?? false;
  }

  isVerified(): boolean {
    if (!this.current) return false;
    return (this.current.buildsRun > 0 && this.current.buildsFailed === 0)
      || (this.current.testsRun > 0 && this.current.testsFailed === 0);
  }

  markComplete(): void {
    this.setPhase('complete');
  }

  clear(): void {
    if (this.current) {
      this.current.phase = 'complete';
      this.checkpoint();
    }
    this.current = null;
  }

  // ── Checkpoint to disk ──

  private checkpoint(): void {
    if (!this.current) return;
    try {
      if (!existsSync(this.checkpointDir)) return;
      const path = join(this.checkpointDir, `${this.current.taskId}.json`);
      writeFileSync(path, JSON.stringify(this.current, null, 2));
    } catch {
      // Checkpoint write may fail — in-memory state still works
    }
  }

  /** Load the most recent incomplete task from disk (for session resume) */
  loadLastTask(): TaskState | null {
    try {
      if (!existsSync(this.checkpointDir)) return null;
      const { readdirSync } = require('node:fs') as typeof import('node:fs');
      const files = readdirSync(this.checkpointDir).filter((f) => f.endsWith('.json'));
      if (files.length === 0) return null;

      // Find most recent incomplete task
      let latest: TaskState | null = null;
      let latestTime = 0;
      for (const f of files) {
        try {
          const content = readFileSync(join(this.checkpointDir, f), 'utf-8');
          const state = JSON.parse(content) as TaskState;
          if (state.phase !== 'complete' && state.startedAt > latestTime) {
            latest = state;
            latestTime = state.startedAt;
          }
        } catch { /* skip corrupt files */ }
      }
      if (latest) {
        this.current = latest;
        getLogger().info('TASK_STATE', `Resumed task ${latest.taskId} from checkpoint (phase: ${latest.phase})`);
      }
      return latest;
    } catch {
      return null;
    }
  }

  formatStatusBlock(): string {
    if (!this.current) return '';
    const t = this.current;
    const lines = [
      '[TASK_STATE]',
      `Task: ${t.taskDescription.slice(0, 120)}`,
      `Phase: ${t.phase}`,
      `Turn: ${t.turns}`,
      `Files read: ${t.filesRead.length > 0 ? t.filesRead.join(', ') : 'none'}`,
      `Files written: ${t.filesWritten.length > 0 ? t.filesWritten.join(', ') : 'none'}`,
      `Builds: ${t.buildsRun} (passed: ${t.buildsPassed}, failed: ${t.buildsFailed})`,
      `Tests: ${t.testsRun} (passed: ${t.testsPassed}, failed: ${t.testsFailed})`,
    ];

    if (t.subtasks.length > 0) {
      const subtaskLines = t.subtasks.map((s) => {
        const icon = s.status === 'completed' ? '[x]' : s.status === 'in_progress' ? '[~]' : s.status === 'blocked' ? '[!]' : '[ ]';
        return `  ${icon} ${s.description}`;
      });
      lines.push(`Subtasks:\n${subtaskLines.join('\n')}`);
    }

    if (t.completionCriteria.length > 0) {
      const critLines = t.completionCriteria.map((c) => `  ${c.met ? '[x]' : '[ ]'} ${c.description}`);
      lines.push(`Completion criteria:\n${critLines.join('\n')}`);
    }

    if (t.errors.length > 0) {
      lines.push(`Recent errors: ${t.errors.slice(-2).map((e) => e.error.slice(0, 100)).join(' | ')}`);
    }
    lines.push('[/TASK_STATE]');
    return lines.join('\n');
  }

  private isContinuation(newDescription: string, newCategory: string): boolean {
    if (!this.current) return false;
    if (this.current.category !== newCategory) return false;
    // Word overlap check
    const oldWords = new Set(this.current.taskDescription.toLowerCase().split(/\s+/));
    const newWords = new Set(newDescription.toLowerCase().split(/\s+/));
    let overlap = 0;
    for (const w of newWords) {
      if (oldWords.has(w) && w.length > 3) overlap++;
    }
    return overlap >= 3;
  }
}
