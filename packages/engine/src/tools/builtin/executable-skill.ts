import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { runExecutableSkill } from '../../executable-skills/ExecutableSkillRunner.js';
import { getExecutableSkillRegistry } from '../../executable-skills/ExecutableSkillRegistry.js';

export async function executableSkillRun(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const name = String(args.name ?? args.skill ?? '').trim();
  if (!name) {
    return { success: false, output: 'name is required', error: 'INVALID_ARGS' };
  }

  const manifest = getExecutableSkillRegistry().get(name);
  if (!manifest) {
    return { success: false, output: `Executable skill not found: ${name}`, error: 'NOT_FOUND' };
  }

  const skillArgs = (args.args as Record<string, unknown>) ?? {};
  const timeout = typeof args.timeout === 'number' ? args.timeout : undefined;
  const maxOutput = typeof args.maxLength === 'number' ? args.maxLength : undefined;

  const result = await runExecutableSkill(name, skillArgs, {
    timeoutMs: timeout,
    maxOutput,
  });

  return {
    success: result.success,
    output: result.output,
    error: result.error,
    metadata: {
      elapsed: result.elapsed,
      exitCode: result.exitCode,
      skill: name,
      sessionId: context.sessionId,
    },
  };
}

export async function executableSkillLoad(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  const name = String(args.name ?? '').trim();
  if (!name) return { success: false, output: 'name is required', error: 'INVALID_ARGS' };
  const md = getExecutableSkillRegistry().loadSkillMd(name);
  if (!md) return { success: false, output: `Skill not found: ${name}`, error: 'NOT_FOUND' };
  return { success: true, output: md };
}
