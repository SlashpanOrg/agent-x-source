import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

export const sessionsCommand: CommandInterface = {
  name: 'sessions',
  description: 'List and manage past sessions',
  usage: '/sessions [list <n>|restore <id>|delete <id>]',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    const subcommand = args[0] ?? 'list';

    if (subcommand === 'list') {
      const store = context.sessionStore;
      if (!store) {
        context.emit('Session store not available.');
        return { success: false, action: 'none' };
      }
      const limit = args[1] ? parseInt(args[1], 10) : 20;
      const listMethod = (store as unknown as { listSessions: (n: number) => Array<Record<string, unknown>> }).listSessions;
      const sessions = typeof listMethod === 'function' ? listMethod.call(store, limit) : [];

      if (sessions.length === 0) {
        context.emit('No past sessions found.');
        return { success: true, action: 'none' };
      }

      const lines = sessions.map((s, idx) => {
        const title = (s['title'] as string) || (s['id'] as string) || 'untitled';
        const date = (s['updatedAt'] as string) || (s['createdAt'] as string) || '';
        const shortDate = date.slice(0, 10);
        const model = (s['model'] as string) || '';
        return `  ${idx + 1}. [${shortDate}] ${title}  (${model})`;
      });
      context.emit(`Recent sessions:\n${lines.join('\n')}\n\nUse /sessions restore <id> to continue.`);
      return { success: true, action: 'none' };
    }

    if (subcommand === 'restore') {
      const id = args[1];
      if (!id) {
        context.emit('Usage: /sessions restore <session-id>');
        return { success: false, action: 'none' };
      }
      return { success: true, output: id, action: 'restore_session' };
    }

    if (subcommand === 'delete') {
      const id = args[1];
      if (!id) {
        context.emit('Usage: /sessions delete <session-id>');
        return { success: false, action: 'none' };
      }
      return { success: true, action: 'delete_session', payload: { id } };
    }

    context.emit('Usage: /sessions [list <n>|restore <id>|delete <id>]');
    return { success: false, action: 'none' };
  },
};
