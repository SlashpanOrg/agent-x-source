import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

export const diffCommand: CommandInterface = {
  name: 'diff',
  description: 'Show a unified diff of changes',
  usage: '/diff [<file>] | /diff --cached | /diff <ref>',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    let cmd: string;
    if (args[0] === '--cached') {
      cmd = 'git diff --cached';
    } else if (args[0] && !args[0].startsWith('-')) {
      const filePath = resolve(args[0]);
      cmd = `git diff -- "${filePath}"`;
    } else if (args[0]) {
      cmd = `git diff ${args[0]}`;
    } else {
      cmd = 'git diff';
    }

    try {
      const output = execSync(cmd, { encoding: 'utf-8', timeout: 10000, cwd: process.cwd() });
      if (!output.trim()) {
        context.emit('No diff output.');
        return { success: true, action: 'none' };
      }
      context.emit(output);
      return { success: true, action: 'none', output };
    } catch (err) {
      context.emit(`Diff failed: ${(err as Error).message}`);
      return { success: false, action: 'none' };
    }
  },
};
