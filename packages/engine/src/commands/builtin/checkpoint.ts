import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

export const checkpointCommand: CommandInterface = {
  name: 'checkpoint',
  description: 'Save a checkpoint to rewind to later',
  usage: '/checkpoint [label]',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    const label = args.join(' ') || `checkpoint-${new Date().toISOString().slice(0, 16)}`;
    return {
      success: true,
      action: 'checkpoint',
      payload: { label, sourceSessionId: context.sessionId },
    };
  },
};

export const rewindCommand: CommandInterface = {
  name: 'rewind',
  description: 'Rewind to the last checkpoint',
  usage: '/rewind',
  async execute(_args: string[], _context: CommandContext): Promise<CommandResult> {
    return { success: true, action: 'rewind' };
  },
};
