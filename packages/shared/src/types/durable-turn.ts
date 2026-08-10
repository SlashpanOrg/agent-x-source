/** Durable turn checkpointing (Prime Agent adoption). */

export type DurableTurnStatus =
  | 'queued'
  | 'running'
  | 'checkpointed'
  | 'complete'
  | 'error'
  | 'cancelled';

export interface TurnCheckpoint {
  sequence: number;
  parts: Array<Record<string, unknown>>;
  partialContent?: string;
  createdAt: string;
}

export interface DurableTurnRecord {
  turnId: string;
  sessionId: string;
  status: DurableTurnStatus;
  generation: number;
  sequence: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  partialContent?: string;
  checkpoints?: TurnCheckpoint[];
}
