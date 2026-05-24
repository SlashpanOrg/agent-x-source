import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';
import { Scheduler } from '../../scheduler/Scheduler.js';
import type { AgentEventBus } from '../../EventBus.js';

let schedulerInstance: Scheduler | null = null;

export function getSchedulerInstance(eventBus?: AgentEventBus): Scheduler {
  if (!schedulerInstance && eventBus) {
    schedulerInstance = new Scheduler(eventBus);
    schedulerInstance.start();
  }
  return schedulerInstance!;
}

export function setSchedulerInstance(scheduler: Scheduler): void {
  schedulerInstance = scheduler;
}

export const scheduleCommand: CommandInterface = {
  name: 'schedule',
  description: 'Manage scheduled/cron tasks',
  aliases: ['cron'],
  usage: '/schedule add <cron> <instruction> | /schedule list | /schedule remove <id>',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    if (!schedulerInstance) {
      context.emit('Scheduler not initialized.');
      return { success: false, action: 'none' };
    }

    const subcommand = args[0]?.toLowerCase();

    if (!subcommand || subcommand === 'list') {
      const jobs = schedulerInstance.getJobs();
      if (jobs.length === 0) {
        context.emit('No scheduled jobs.');
      } else {
        const lines = jobs.map((j) => {
          const status = j.enabled ? '✓' : '✗';
          const next = new Date(j.nextRun).toLocaleString();
          return `  [${status}] ${j.name} (${j.cron}) — next: ${next} — runs: ${j.runCount}`;
        });
        context.emit(['Scheduled Jobs:', '', ...lines].join('\n'));
      }
      return { success: true, action: 'none' };
    }

    if (subcommand === 'add') {
      // /schedule add "*/5 * * * *" "check for new emails"
      // Parse: first 5 space-separated fields = cron, rest = instruction
      const rest = args.slice(1).join(' ');

      // Try quoted cron: /schedule add "* * * * *" instruction
      const quotedMatch = rest.match(/^["']([^"']+)["']\s+(.+)$/);
      if (quotedMatch) {
        const cron = quotedMatch[1] ?? '';
        const instruction = quotedMatch[2] ?? '';
        const name = instruction.slice(0, 30);
        try {
          const job = schedulerInstance.addJob(name, cron, instruction);
          context.emit(`Scheduled: "${job.name}" [${job.cron}] — ID: ${job.id}`);
        } catch (e) {
          context.emit(`Error: ${e instanceof Error ? e.message : 'Invalid cron expression'}`);
          return { success: false, action: 'none' };
        }
        return { success: true, action: 'none' };
      }

      // Try unquoted: first 5 fields are cron
      const parts = rest.split(/\s+/);
      if (parts.length >= 6) {
        const cron = parts.slice(0, 5).join(' ');
        const instruction = parts.slice(5).join(' ');
        const name = instruction.slice(0, 30);
        try {
          const job = schedulerInstance.addJob(name, cron, instruction);
          context.emit(`Scheduled: "${job.name}" [${job.cron}] — ID: ${job.id}`);
        } catch (e) {
          context.emit(`Error: ${e instanceof Error ? e.message : 'Invalid cron expression'}`);
          return { success: false, action: 'none' };
        }
        return { success: true, action: 'none' };
      }

      context.emit('Usage: /schedule add "*/5 * * * *" <instruction>');
      return { success: false, action: 'none' };
    }

    if (subcommand === 'remove' || subcommand === 'rm') {
      const id = args[1];
      if (!id) {
        context.emit('Usage: /schedule remove <job-id>');
        return { success: false, action: 'none' };
      }
      if (schedulerInstance.removeJob(id)) {
        context.emit(`Removed job ${id}`);
      } else {
        context.emit(`Job not found: ${id}`);
      }
      return { success: true, action: 'none' };
    }

    if (subcommand === 'toggle') {
      const id = args[1];
      if (!id) {
        context.emit('Usage: /schedule toggle <job-id>');
        return { success: false, action: 'none' };
      }
      const enabled = schedulerInstance.toggleJob(id);
      context.emit(`Job ${id} is now ${enabled ? 'enabled' : 'disabled'}`);
      return { success: true, action: 'none' };
    }

    context.emit('Unknown subcommand. Use: list, add, remove, toggle');
    return { success: false, action: 'none' };
  },
};
