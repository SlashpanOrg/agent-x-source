import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

export const costCommand: CommandInterface = {
  name: 'cost',
  description: 'Show current session cost and token usage',
  usage: '/cost',
  async execute(_args: string[], context: CommandContext): Promise<CommandResult> {
    return {
      success: true,
      action: 'show_cost',
      payload: { sessionId: context.sessionId },
    };
  },
};
