import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';
import type { UserCommandRegistry } from '../UserCommandRegistry.js';

let userCommandRegistryInstance: UserCommandRegistry | null = null;

export function setUserCommandRegistryInstance(registry: UserCommandRegistry): void {
  userCommandRegistryInstance = registry;
}

export function getUserCommandRegistryInstance(): UserCommandRegistry | null {
  return userCommandRegistryInstance;
}

export const commandsCommand: CommandInterface = {
  name: 'commands',
  description: 'List and manage user-defined commands',
  usage: '/commands [list|add|edit|remove]',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    if (!userCommandRegistryInstance) {
      context.emit('User command registry not available.');
      return { success: false, action: 'none' };
    }

    const sub = args[0] ?? 'list';

    if (sub === 'list') {
      const cmds = userCommandRegistryInstance.listCommands();
      if (cmds.length === 0) {
        context.emit('No user-defined commands. Define them in config under `commands` key.');
        return { success: true, action: 'none' };
      }

      const lines = cmds.map((c) => {
        const vars = c.variables?.length ? ` <${c.variables.join('> <')}>` : '';
        return `  /${c.name}${vars} — ${c.description}`;
      });
      context.emit(`User-defined commands:\n${lines.join('\n')}\n\nUse /commands add <name> <description> <template> to add a new command.`);
      return { success: true, action: 'none' };
    }

    if (sub === 'add') {
      const name = args[1];
      const description = args[2];
      const template = args.slice(3).join(' ');
      if (!name || !description || !template) {
        context.emit('Usage: /commands add <name> <description> <template>');
        return { success: false, action: 'none' };
      }
      if (userCommandRegistryInstance.getConfig(name)) {
        context.emit(`Command "${name}" already exists. Use /commands edit to modify it.`);
        return { success: false, action: 'none' };
      }
      userCommandRegistryInstance.register({ name, description, template });
      context.emit(`✓ Added command /${name}`);
      return { success: true, action: 'none' };
    }

    if (sub === 'edit') {
      const name = args[1];
      const field = args[2];
      const value = args.slice(3).join(' ');
      if (!name || !field || !value) {
        context.emit('Usage: /commands edit <name> <field> <value>');
        return { success: false, action: 'none' };
      }
      if (!userCommandRegistryInstance.getConfig(name)) {
        context.emit(`Command "${name}" not found.`);
        return { success: false, action: 'none' };
      }
      if (!['description', 'template', 'name'].includes(field)) {
        context.emit('Field must be "description", "template", or "name".');
        return { success: false, action: 'none' };
      }
      userCommandRegistryInstance.updateConfig(name, { [field]: value });
      context.emit(`✓ Updated /${name} ${field}`);
      return { success: true, action: 'none' };
    }

    if (sub === 'remove' || sub === 'rm') {
      const name = args[1];
      if (!name) {
        context.emit('Usage: /commands remove <name>');
        return { success: false, action: 'none' };
      }
      if (!userCommandRegistryInstance.getConfig(name)) {
        context.emit(`Command "${name}" not found.`);
        return { success: false, action: 'none' };
      }
      userCommandRegistryInstance.unregister(name);
      context.emit(`✓ Removed command /${name}`);
      return { success: true, action: 'none' };
    }

    const cmds = userCommandRegistryInstance.listCommands();
    if (cmds.length === 0) {
      context.emit('No user-defined commands.');
      return { success: true, action: 'none' };
    }
    const lines = cmds.map((c) => {
      const vars = c.variables?.length ? ` <${c.variables.join('> <')}>` : '';
      return `  /${c.name}${vars} — ${c.description}`;
    });
    context.emit(`User-defined commands:\n${lines.join('\n')}`);
    return { success: true, action: 'none' };
  },
};
