import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';
import type { TaskManager } from '../../agent/TaskManager.js';

let taskManagerInstance: TaskManager | null = null;

export function setTaskManagerInstance(tm: TaskManager): void {
  taskManagerInstance = tm;
}

export const bgCommand: CommandInterface = {
  name: 'bg',
  description: 'Move current task to background',
  usage: '/bg',
  async execute(_args: string[], context: CommandContext): Promise<CommandResult> {
    if (!taskManagerInstance) {
      context.emit('Task manager not available.');
      return { success: false, action: 'none' };
    }

    const foreground = taskManagerInstance.getForegroundTask();
    if (!foreground) {
      context.emit('No foreground task to background.');
      return { success: false, action: 'none' };
    }

    taskManagerInstance.backgroundTask(foreground.id);
    context.emit(`Task "${foreground.name}" moved to background.`);
    return { success: true, action: 'none' };
  },
};

export const tasksCommand: CommandInterface = {
  name: 'tasks',
  description: 'List active and completed background tasks',
  usage: '/tasks',
  async execute(_args: string[], context: CommandContext): Promise<CommandResult> {
    if (!taskManagerInstance) {
      context.emit('Task manager not available.');
      return { success: false, action: 'none' };
    }

    const all = taskManagerInstance.getAllTasks();
    if (all.length === 0) {
      context.emit('No tasks.');
      return { success: true, action: 'none' };
    }

    const background = taskManagerInstance.getBackgroundTasks();
    const foreground = taskManagerInstance.getForegroundTask();
    const running = taskManagerInstance.getRunningTasks();

    const lines: string[] = ['Tasks:'];

    if (foreground) {
      const elapsed = Math.round((Date.now() - foreground.startTime) / 1000);
      lines.push(`  [FG] ${foreground.name} — ${elapsed}s — ${foreground.tokensUsed} tokens`);
    }

    if (background.length > 0) {
      lines.push('');
      lines.push('  Background:');
      for (const t of background) {
        const elapsed = Math.round((Date.now() - t.startTime) / 1000);
        lines.push(`    • ${t.name} — ${t.status} — ${elapsed}s`);
      }
    }

    if (running.length === 0 && !foreground) {
      lines.push('  No running tasks.');
    }

    // Show recent completed tasks
    const completed = all.filter((t) => t.status === 'completed').slice(-3);
    if (completed.length > 0) {
      lines.push('');
      lines.push('  Recent:');
      for (const t of completed) {
        const elapsed = t.endTime ? Math.round((t.endTime - t.startTime) / 1000) : 0;
        lines.push(`    ✓ ${t.name} — ${elapsed}s`);
      }
    }

    context.emit(lines.join('\n'));
    return { success: true, action: 'none' };
  },
};
