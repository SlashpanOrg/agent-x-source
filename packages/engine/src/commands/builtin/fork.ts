import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

export const forkCommand: CommandInterface = {
  name: 'fork',
  description: 'Fork the current session into a new one',
  usage: '/fork [name]',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    const name = args.join(' ') || undefined;
    return {
      success: true,
      action: 'fork_session',
      payload: { name, sourceSessionId: context.sessionId },
    };
  },
};
