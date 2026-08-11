/** Command idempotency journal (Prime Agent adoption). */

export type CommandJournalStatus = 'received' | 'completed' | 'failed' | 'uncertain';

export interface CommandJournalEntry {
  id: string;
  idempotencyKey: string;
  commandType: string;
  sessionId?: string;
  payload: Record<string, unknown>;
  status: CommandJournalStatus;
  result?: Record<string, unknown>;
  error?: string;
  receivedAt: string;
  completedAt?: string;
}
