import { getLogger } from '@agentx/shared';

export interface VerificationResult {
  ran: boolean;
  success: boolean;
  command: string;
  output: string;
  errorType?: 'compile' | 'test' | 'lint' | 'typecheck' | 'runtime' | 'unknown';
  errorSummary?: string;
}

/**
 * Parses build/test/lint command output to determine whether verification
 * actually passed — not just that a command was run.
 *
 * Supports: npm/tsc/cargo/go/python/make + jest/vitest/pytest/mocha
 */
export class VerificationResultParser {
  private static readonly SUCCESS_PATTERNS: RegExp[] = [
    /build\s+success/i,
    /compiled\s+successfully/i,
    /\b0\s+errors\b/i,
    /✓.*\bpassed\b/i,
    /all\s+tests\s+passed/i,
    /\b\d+\s+passing\b/i,
    /test\s+result:\s*ok\b/i,
    /finished\s+in\s+[\d.]+s/i,
    /no\s+issues?\s+found/i,
    /0\s+failing/i,
    /compilation\s+successful/i,
    /\bdone\b/i,
  ];

  private static readonly FAILURE_PATTERNS: RegExp[] = [
    /error\s+TS\d+/i,
    /error:\s+/i,
    /\bFAILED\b/i,
    /\b\d+\s+failing\b/i,
    /\b\d+\s+failures?\b/i,
    /test\s+result:\s*fail/i,
    /compilation\s+failed/i,
    /build\s+failed/i,
    /cannot\s+find\s+module/i,
    /syntax\s+error/i,
    /unresolved\s+import/i,
    /command\s+not\s+found/i,
    /panic:/i,
    /traceback\b/i,
    /\berror\[E\d+\]/i, // Rust
  ];

  /**
   * Analyze a tool call output to determine if it was a verification command
   * and whether it passed.
   */
  parse(toolId: string, toolOutput: string, args?: Record<string, unknown>): VerificationResult {
    const command = this.extractCommand(toolId, args);
    if (!command) {
      return { ran: false, success: false, command: '', output: toolOutput };
    }

    if (!this.isVerificationCommand(command)) {
      return { ran: false, success: false, command, output: toolOutput };
    }

    const output = toolOutput;
    const hasSuccess = VerificationResultParser.SUCCESS_PATTERNS.some((p) => p.test(output));
    const hasFailure = VerificationResultParser.FAILURE_PATTERNS.some((p) => p.test(output));

    // If both match, failure patterns take precedence (more specific)
    const success = hasSuccess && !hasFailure;
    const errorType = success ? undefined : this.classifyError(command, output);
    const errorSummary = success ? undefined : this.extractErrorSummary(output);

    getLogger().info('VERIFICATION', `Command: ${command}, success: ${success}, errorType: ${errorType ?? 'none'}`);

    return { ran: true, success, command, output, errorType, errorSummary };
  }

  private extractCommand(_toolId: string, args?: Record<string, unknown>): string {
    if (!args) return '';
    const cmd = typeof args['command'] === 'string' ? args['command']
      : typeof args['cmd'] === 'string' ? args['cmd']
      : '';
    return cmd;
  }

  private isVerificationCommand(command: string): boolean {
    const lower = command.toLowerCase();
    const verificationPatterns = [
      /\bnpm\s+(run\s+)?build\b/,
      /\bnpm\s+test\b/,
      /\bnpm\s+run\s+lint\b/,
      /\bnpm\s+run\s+typecheck\b/,
      /\bnpm\s+run\s+tsc\b/,
      /\bpnpm\s+(run\s+)?build\b/,
      /\bpnpm\s+test\b/,
      /\byarn\s+(run\s+)?build\b/,
      /\byarn\s+test\b/,
      /\btsc\b/,
      /\bcargo\s+build\b/,
      /\bcargo\s+test\b/,
      /\bgo\s+build\b/,
      /\bgo\s+test\b/,
      /\bpytest\b/,
      /\bpython\s+-m\s+unittest\b/,
      /\bmake\b/,
      /\bjest\b/,
      /\bvitest\b/,
      /\bmocha\b/,
      /\beslint\b/,
      /\bruff\b/,
      /\bflake8\b/,
      /\bmypy\b/,
    ];
    return verificationPatterns.some((p) => p.test(lower));
  }

  private classifyError(command: string, output: string): VerificationResult['errorType'] {
    if (/error\s+TS\d+/.test(output) || /tsc\b/i.test(command)) return 'typecheck';
    if (/eslint|ruff|flake8|pylint/i.test(command)) return 'lint';
    if (/jest|vitest|pytest|mocha|cargo\s+test|go\s+test|npm\s+test/i.test(command)) return 'test';
    if (/cargo\s+build|go\s+build|npm\s+run\s+build|tsc\b/i.test(command)) return 'compile';
    if (/panic:|traceback|exception/i.test(output)) return 'runtime';
    return 'unknown';
  }

  private extractErrorSummary(output: string): string {
    const lines = output.split('\n');
    const errorLines = lines.filter((l) =>
      /error|Error|ERROR|FAILED|failed|panic|traceback/i.test(l),
    );
    if (errorLines.length === 0) return output.slice(0, 300);
    return errorLines.slice(0, 5).join('\n').slice(0, 500);
  }

  /**
   * Generate a fix-and-retry instruction for the build-fix loop.
   */
  formatFixInstruction(result: VerificationResult): string {
    if (result.success) return '';
    const errorType = result.errorType ?? 'unknown';
    const summary = result.errorSummary ?? 'Unknown error';
    return `[BUILD FIX REQUIRED] The ${errorType} verification failed with:\n${summary}\nFix the error and re-run: ${result.command}`;
  }
}
