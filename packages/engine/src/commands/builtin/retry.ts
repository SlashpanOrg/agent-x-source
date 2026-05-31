import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

export const retryCommand: CommandInterface = {
  name: 'retry',
  description: 'Retry the last failed operation',
  aliases: ['redo'],
  usage: '/retry',
  async execute(_args: string[], context: CommandContext): Promise<CommandResult> {
    context.emit('⟳ Retrying...');
    return { success: true, output: 'retry_last', action: 'none' };
  },
};
