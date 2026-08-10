/** Non-blocking subagent admission (Prime Agent adoption). */

export type SubAgentAdmissionMode = 'blocking' | 'admitted';

export interface SubAgentSpawnHandle {
  taskId: string;
  childSessionId: string;
  name?: string;
  status: 'admitted' | 'running' | 'completed' | 'failed' | 'cancelled';
  admittedAt: string;
  sessionDir?: string;
}

export interface SubAgentAdmissionResult {
  mode: SubAgentAdmissionMode;
  handle?: SubAgentSpawnHandle;
  /** Present when mode is blocking (legacy). */
  result?: string;
}
