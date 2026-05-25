import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';
import { CrewManager } from '../../secret-sauce/CrewManager.js';

export const crewCommand: CommandInterface = {
  name: 'crew',
  description: 'Switch or create crews',
  usage: '/crew',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    const subcommand = args[0];
    const pm = new CrewManager();

    if (subcommand === 'show') {
      const id = args[1] ?? pm.getActiveId();
      const crew = pm.get(id);
      if (!crew) {
        context.emit(`Crew "${id}" not found.`);
        return { success: false, action: 'none' };
      }
      const lines = [
        `Crew: ${crew.name} (${crew.id})`,
        `Prompt: ${crew.systemPrompt.slice(0, 120)}${crew.systemPrompt.length > 120 ? '...' : ''}`,
      ];
      context.emit(lines.join('\n'));
      return { success: true, action: 'none' };
    }

    // Default: open crew picker UI (handles list, switch, create)
    return { success: true, action: 'switch_crew' };
  },
};
