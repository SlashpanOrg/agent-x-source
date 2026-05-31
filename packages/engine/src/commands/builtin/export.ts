import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

export const exportCommand: CommandInterface = {
  name: 'export',
  description: 'Export current session as markdown or JSONL',
  usage: '/export [format]',
  aliases: ['ex'],
  async execute(args: string[], _context: CommandContext): Promise<CommandResult> {
    const format = (args[0] ?? 'markdown').toLowerCase();
    if (format !== 'markdown' && format !== 'jsonl') {
      return { success: false, output: 'Usage: /export [markdown|jsonl]' };
    }
    return {
      success: true,
      action: 'export_session',
      payload: { format },
    };
  },
};
