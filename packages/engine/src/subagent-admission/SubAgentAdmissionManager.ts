import type { SubAgentSpawnHandle } from '@agentx/shared';
import { isSubagentAdmissionEnabled } from '@agentx/shared';

const MAX_CONCURRENT = 4;

export class SubAgentAdmissionManager {
  private readonly active = new Map<string, SubAgentSpawnHandle>();

  isEnabled(): boolean {
    return isSubagentAdmissionEnabled();
  }

  reserveSlot(): { ok: true } | { ok: false; reason: string } {
    if (!this.isEnabled()) {
      return { ok: false, reason: 'Subagent admission is disabled.' };
    }
    const running = [...this.active.values()].filter((h) => h.status === 'running' || h.status === 'admitted');
    if (running.length >= MAX_CONCURRENT) {
      return { ok: false, reason: 'Subagent capacity reached — wait for running tasks to finish.' };
    }
    return { ok: true };
  }

  register(handle: SubAgentSpawnHandle): void {
    this.active.set(handle.taskId, handle);
  }

  markRunning(taskId: string): void {
    const h = this.active.get(taskId);
    if (h) h.status = 'running';
  }

  complete(taskId: string, status: 'completed' | 'failed' | 'cancelled' = 'completed'): void {
    const h = this.active.get(taskId);
    if (h) {
      h.status = status;
      this.active.delete(taskId);
    }
  }

  listActive(): SubAgentSpawnHandle[] {
    return [...this.active.values()];
  }
}

let manager: SubAgentAdmissionManager | null = null;

export function getSubAgentAdmissionManager(): SubAgentAdmissionManager {
  if (!manager) manager = new SubAgentAdmissionManager();
  return manager;
}
