import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

export const planCommand: CommandInterface = {
  name: 'plan',
  description: 'Toggle plan mode — agent generates a plan for approval before executing',
  aliases: ['plans'],
  usage: '/plan [on|off]',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    const toggle = args[0]?.toLowerCase();
    const msg = toggle === 'on' ? '⚠ Plan mode activated.' : toggle === 'off' ? '✓ Plan mode deactivated.' : 'Usage: /plan [on|off]';
    context.emit(msg);
    return { success: true, output: toggle ?? 'toggle', action: 'plan_mode' };
  },
};
