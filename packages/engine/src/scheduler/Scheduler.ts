import type { EngineEvent } from '@agentx/shared';
import { generateId } from '@agentx/shared';
import type { AgentEventBus } from '../EventBus.js';

export interface ScheduledJob {
  id: string;
  name: string;
  cron: string;
  instruction: string;
  enabled: boolean;
  lastRun?: number;
  nextRun: number;
  runCount: number;
}

interface ParsedCron {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
}

/**
 * Minimal cron expression parser supporting standard 5-field format:
 * minute hour day-of-month month day-of-week
 *
 * Supports: *, specific numbers, ranges (1-5), steps (x/n), lists (1,3,5)
 */
function parseCronField(field: string, min: number, max: number): number[] {
  const values: Set<number> = new Set();

  for (const part of field.split(',')) {
    if (part === '*') {
      for (let i = min; i <= max; i++) values.add(i);
    } else if (part.includes('/')) {
      const segments = part.split('/');
      const range = segments[0] ?? '*';
      const step = parseInt(segments[1] ?? '1', 10);
      const start = range === '*' ? min : parseInt(range, 10);
      for (let i = start; i <= max; i += step) values.add(i);
    } else if (part.includes('-')) {
      const segments = part.split('-');
      const start = parseInt(segments[0] ?? '0', 10);
      const end = parseInt(segments[1] ?? '0', 10);
      for (let i = start; i <= end; i++) values.add(i);
    } else {
      values.add(parseInt(part, 10));
    }
  }

  return [...values].filter((v) => v >= min && v <= max).sort((a, b) => a - b);
}

function parseCron(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }

  return {
    minutes: parseCronField(parts[0]!, 0, 59),
    hours: parseCronField(parts[1]!, 0, 23),
    daysOfMonth: parseCronField(parts[2]!, 1, 31),
    months: parseCronField(parts[3]!, 1, 12),
    daysOfWeek: parseCronField(parts[4]!, 0, 6),
  };
}

function getNextRunTime(cron: ParsedCron, after: Date = new Date()): number {
  const d = new Date(after.getTime() + 60_000); // start from next minute
  d.setSeconds(0, 0);

  // Search up to 1 year ahead
  const limit = d.getTime() + 365 * 24 * 60 * 60_000;

  while (d.getTime() < limit) {
    if (
      cron.months.includes(d.getMonth() + 1) &&
      cron.daysOfMonth.includes(d.getDate()) &&
      cron.daysOfWeek.includes(d.getDay()) &&
      cron.hours.includes(d.getHours()) &&
      cron.minutes.includes(d.getMinutes())
    ) {
      return d.getTime();
    }
    d.setMinutes(d.getMinutes() + 1);
  }

  return after.getTime() + 60 * 60_000; // fallback: 1 hour
}

export class Scheduler {
  private jobs: Map<string, ScheduledJob> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;
  private eventBus: AgentEventBus;
  private onJobTrigger: ((job: ScheduledJob) => void) | null = null;

  constructor(eventBus: AgentEventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Set a callback invoked when a scheduled job fires.
   * The callback receives the job — the agent should process its instruction.
   */
  setTriggerHandler(handler: (job: ScheduledJob) => void): void {
    this.onJobTrigger = handler;
  }

  addJob(name: string, cron: string, instruction: string): ScheduledJob {
    const parsed = parseCron(cron);
    const job: ScheduledJob = {
      id: generateId(),
      name,
      cron,
      instruction,
      enabled: true,
      nextRun: getNextRunTime(parsed),
      runCount: 0,
    };

    this.jobs.set(job.id, job);
    this.eventBus.emit({
      type: 'steer_message',
      taskId: job.id,
      instruction: `Scheduled job "${name}" (${cron}) — next run: ${new Date(job.nextRun).toLocaleTimeString()}`,
    } as EngineEvent);

    this.ensureTimerRunning();
    return job;
  }

  removeJob(jobId: string): boolean {
    const deleted = this.jobs.delete(jobId);
    if (this.jobs.size === 0) this.stop();
    return deleted;
  }

  getJobs(): ScheduledJob[] {
    return [...this.jobs.values()];
  }

  getEnabledJobs(): ScheduledJob[] {
    return [...this.jobs.values()].filter((j) => j.enabled);
  }

  toggleJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (job) {
      job.enabled = !job.enabled;
      return job.enabled;
    }
    return false;
  }

  start(): void {
    this.ensureTimerRunning();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private ensureTimerRunning(): void {
    if (this.timer) return;
    // Check every 30 seconds for jobs that need to fire
    this.timer = setInterval(() => this.tick(), 30_000);
  }

  private tick(): void {
    const now = Date.now();
    for (const job of this.jobs.values()) {
      if (!job.enabled) continue;
      if (now >= job.nextRun) {
        job.lastRun = now;
        job.runCount++;

        // Compute next run time
        const parsed = parseCron(job.cron);
        job.nextRun = getNextRunTime(parsed);

        this.eventBus.emit({
          type: 'steer_message',
          taskId: job.id,
          instruction: `⏰ Scheduled job "${job.name}" triggered (run #${job.runCount})`,
        } as EngineEvent);

        if (this.onJobTrigger) {
          this.onJobTrigger(job);
        }
      }
    }
  }
}
