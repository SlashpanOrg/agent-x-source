import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

export const copyCommand: CommandInterface = {
  name: 'copy',
  description: 'Copy session export to clipboard (markdown format)',
  usage: '/copy',
  async execute(_args: string[], _context: CommandContext): Promise<CommandResult> {
    return {
      success: true,
      action: 'copy_session',
    };
  },
};
