import type { EngineEvent } from '@agentx/shared';
import type { ToolLedger } from './ToolLedger.js';
import type { CategoryResult } from '../prompt/CategoryDetector.js';
import type { TaskStateManager } from './TaskStateManager.js';
import { VerificationResultParser, type VerificationResult } from './VerificationResultParser.js';

/**
 * Runtime enforcement for coding/development turns.
 *
 * Guards:
 * 1. Read-before-write: file_write is blocked unless file_read was called on the same path this turn.
 * 2. Verification gate: after file_write in a coding turn, the model must run build/test and it must PASS.
 * 3. Safety gate: git push, git reset --hard, rm -rf, and similar destructive ops require explicit approval.
 * 4. Build-fix loop: if verification fails, inject a fix-and-retry instruction (up to maxRetries).
 */
export class CodingTurnGuard {
  private ledger: ToolLedger;
  private emit: (event: EngineEvent) => void;
  private taskState: TaskStateManager | null;
  private verifier: VerificationResultParser;
  private filesWrittenThisTurn = new Set<string>();
  private verificationGateArmed = false;
  private verificationPassed = false;
  private lastVerificationResult: VerificationResult | null = null;
  private buildFixAttempts = 0;
  private readonly maxBuildFixRetries = 3;

  constructor(ledger: ToolLedger, emit: (event: EngineEvent) => void, taskState?: TaskStateManager) {
    this.ledger = ledger;
    this.emit = emit;
    this.taskState = taskState ?? null;
    this.verifier = new VerificationResultParser();
  }

  setTaskState(taskState: TaskStateManager): void {
    this.taskState = taskState;
  }

  resetForTurn(): void {
    this.filesWrittenThisTurn.clear();
    this.verificationGateArmed = false;
    this.verificationPassed = false;
    this.lastVerificationResult = null;
    this.buildFixAttempts = 0;
  }

  /**
   * Check if a tool call should be allowed. Returns null if allowed, or an error message to inject.
   */
  checkToolCall(
    toolId: string,
    args: Record<string, unknown>,
    category: CategoryResult | null,
  ): string | null {
    if (!category) return null;
    const isCodingTurn = category.primary === 'coding' || category.primary === 'edge';

    // ── Read-before-write guard ──
    if (toolId === 'file_write' && isCodingTurn) {
      const path = typeof args?.path === 'string' ? args.path : '';
      if (path && !this.hasReadFile(path)) {
        this.emit({ type: 'read_before_write_blocked', filePath: path, reason: 'file_read not called on this path before file_write' });
        return `BLOCKED: You must call file_read on "${path}" before writing to it. Read the file first, then make your edit.`;
      }
    }

    // ── Safety gate for destructive operations ──
    if (isCodingTurn) {
      const blocked = this.checkDestructiveOp(toolId, args);
      if (blocked) {
        this.emit({ type: 'safety_gate_blocked', operation: blocked.operation, reason: blocked.reason });
        return blocked.message;
      }
    }

    return null;
  }

  /**
   * Called after a successful tool execution. Arms the verification gate if needed,
   * and parses build/test output for real verification.
   */
  onToolExecuted(
    toolId: string,
    success: boolean,
    args: Record<string, unknown>,
    category: CategoryResult | null,
  ): void {
    if (!category) return;
    const isCodingTurn = category.primary === 'coding' || category.primary === 'edge';

    // Track file reads
    if (toolId === 'file_read' && success) {
      const path = typeof args?.path === 'string' ? args.path : '';
      if (path) this.taskState?.recordFileRead(path);
    }

    // Track file writes — arm verification gate
    if (toolId === 'file_write' && success && isCodingTurn) {
      const path = typeof args?.path === 'string' ? args.path : 'unknown';
      this.filesWrittenThisTurn.add(path);
      this.verificationGateArmed = true;
      this.verificationPassed = false;
      this.taskState?.recordFileWrite(path);
      this.emit({ type: 'verification_gate_triggered', filePath: path, reason: 'file_write in coding turn — run build/test before finishing' });
    }

    // Real verification: parse build/test command output
    if (success && isCodingTurn) {
      const result = this.verifier.parse(toolId, this.getLastToolOutput(toolId), args);
      if (result.ran) {
        this.lastVerificationResult = result;
        if (result.command.includes('test') || /jest|vitest|pytest|mocha/.test(result.command)) {
          this.taskState?.recordTest(result.success);
        } else {
          this.taskState?.recordBuild(result.success);
        }

        if (result.success) {
          this.verificationPassed = true;
          this.verificationGateArmed = false;
        } else {
          // Build/test failed — arm the build-fix loop
          this.verificationPassed = false;
          this.buildFixAttempts++;
          this.taskState?.recordError(result.errorSummary ?? 'Build/test failed');
        }
      }
    }

    this.taskState?.recordTool(toolId);
  }

  /**
   * Returns a system message to inject if the verification gate is armed and the model
   * hasn't run a successful build/test yet. Includes build-fix loop instructions.
   */
  getVerificationReminder(): string | null {
    if (!this.verificationGateArmed) return null;
    if (this.verificationPassed) return null;

    // Build-fix loop: if the last verification failed, inject fix instructions
    if (this.lastVerificationResult && !this.lastVerificationResult.success) {
      if (this.buildFixAttempts > this.maxBuildFixRetries) {
        return `[VERIFICATION GATE] Build/test has failed ${this.buildFixAttempts} times. Stop retrying. Summarize the errors for the user and ask how they would like to proceed.`;
      }
      const fixInstruction = this.verifier.formatFixInstruction(this.lastVerificationResult);
      if (fixInstruction) {
        return `${fixInstruction}\n\nAttempt ${this.buildFixAttempts} of ${this.maxBuildFixRetries}.`;
      }
    }

    // Default: haven't run any verification yet
    if (this.hasRunBuildOrTest()) return null;
    return '[VERIFICATION GATE] You have written files this turn but have not run a build, lint, or test command. Run the project build or test suite before declaring the task complete.';
  }

  private hasReadFile(path: string): boolean {
    const normalized = this.normalizePath(path);
    // Check tool ledger for this turn
    if (this.ledger.getEntries().some(
      (e) => e.name === 'file_read' && e.success && this.normalizePath(e.path ?? '') === normalized,
    )) return true;
    // Check task state for cross-turn reads
    return this.taskState?.hasReadFile(path) ?? false;
  }

  private hasRunBuildOrTest(): boolean {
    const buildTools = ['shell_exec', 'bash', 'run_command', 'execute'];
    const buildPatterns = ['npm run build', 'npm test', 'npm run lint', 'tsc', 'cargo build', 'cargo test', 'pytest', 'go test', 'make', 'jest', 'vitest'];
    return this.ledger.getEntries().some((e) => {
      if (!e.success) return false;
      if (!buildTools.includes(e.name)) return false;
      const output = e.output.toLowerCase();
      return buildPatterns.some((p) => output.includes(p));
    });
  }

  private getLastToolOutput(toolId: string): string {
    const entries = this.ledger.getEntries();
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i]!.name === toolId) return entries[i]!.output;
    }
    return '';
  }

  private checkDestructiveOp(toolId: string, args: Record<string, unknown>): { operation: string; reason: string; message: string } | null {
    const command = typeof args?.command === 'string' ? args.command : '';

    if (toolId === 'git_commit' || toolId === 'git_push') {
      if (/push|push\s+--force|push\s+-f/.test(command)) {
        return {
          operation: 'git push',
          reason: 'git push requires explicit user approval during coding turns',
          message: 'BLOCKED: Do not push to git without explicit user approval. Ask the user if they want to push.',
        };
      }
    }

    if (/\bgit\s+reset\s+--hard\b/.test(command)) {
      return {
        operation: 'git reset --hard',
        reason: 'git reset --hard is irreversible during coding turns',
        message: 'BLOCKED: git reset --hard is irreversible. Ask the user for explicit approval before running it.',
      };
    }

    if (/\brm\s+-rf\b/.test(command)) {
      return {
        operation: 'rm -rf',
        reason: 'rm -rf is destructive during coding turns',
        message: 'BLOCKED: rm -rf is destructive. Ask the user for explicit approval before running it.',
      };
    }

    return null;
  }

  private normalizePath(p: string): string {
    return p.replace(/\/+$/g, '').replace(/\\/g, '/').toLowerCase();
  }
}
