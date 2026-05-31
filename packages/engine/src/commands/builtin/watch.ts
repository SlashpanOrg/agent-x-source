import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';
import { FileWatcher } from '../../session/FileWatcher.js';

let fileWatcherInstance: FileWatcher | null = null;

export function setFileWatcherInstance(watcher: FileWatcher): void {
  fileWatcherInstance = watcher;
}

export function getFileWatcherInstance(): FileWatcher | null {
  return fileWatcherInstance;
}

export const watchCommand: CommandInterface = {
  name: 'watch',
  description: 'Watch files and auto-run a command on change',
  usage: '/watch <pattern> <command> | /watch list | /watch stop <pattern> | /watch stop-all | /watch test | /watch lint',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    const sub = args[0];

    if (!sub || sub === 'list') {
      if (!fileWatcherInstance || !fileWatcherInstance.isWatching()) {
        context.emit('No active watches.');
        return { success: true, action: 'none' };
      }
      const entries = fileWatcherInstance.getEntries();
      const lines = entries.map((e, i) => `  ${i + 1}. "${e.pattern}" → ${e.command}`);
      context.emit(`Active watches:\n${lines.join('\n')}`);
      return { success: true, action: 'none' };
    }

    if (sub === 'stop-all') {
      if (fileWatcherInstance) {
        fileWatcherInstance.removeAllWatches();
      }
      context.emit('All watches stopped.');
      return { success: true, action: 'none' };
    }

    if (sub === 'stop') {
      const pattern = args[1];
      if (!pattern) {
        context.emit('Usage: /watch stop <pattern>');
        return { success: false, action: 'none' };
      }
      if (fileWatcherInstance) {
        fileWatcherInstance.removeWatch(pattern);
      }
      context.emit(`Watch "${pattern}" stopped.`);
      return { success: true, action: 'none' };
    }

    if (sub === 'test') {
      if (!fileWatcherInstance) {
        fileWatcherInstance = new FileWatcher();
      }
      fileWatcherInstance.addWatch('**/*.ts', 'test', process.cwd());
      context.emit(`Watching **/*.ts for changes → runs tests on change.`);
      return { success: true, action: 'none' };
    }

    if (sub === 'lint') {
      if (!fileWatcherInstance) {
        fileWatcherInstance = new FileWatcher();
      }
      fileWatcherInstance.addWatch('**/*.ts', 'lint', process.cwd());
      context.emit(`Watching **/*.ts for changes → runs linter on save.`);
      return { success: true, action: 'none' };
    }

    // /watch <pattern> <command>
    const pattern = sub;
    const command = args.slice(1).join(' ');
    if (!command) {
      context.emit('Usage: /watch <pattern> <command>');
      return { success: false, action: 'none' };
    }
    if (!fileWatcherInstance) {
      fileWatcherInstance = new FileWatcher();
    }
    fileWatcherInstance.addWatch(pattern, command);
    context.emit(`Watching "${pattern}" → "${command}"`);
    return { success: true, action: 'none' };
  },
};
