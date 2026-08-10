import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { configureAdoptionFromConfig } from '@agentx/shared';
import { setAdoptionDbPool } from '../../src/adoption/adoption-db.js';
import { CommandJournal } from '../../src/command-journal/CommandJournal.js';
import { AdoptionFakePgPool } from './adoption-fake-pg.js';

describe('Phase 2 command journal idempotency integration', () => {
  const pool = new AdoptionFakePgPool();

  beforeEach(() => {
    configureAdoptionFromConfig({
      provider: { activeProvider: 'openai', activeModel: 'gpt-4' },
      ui: {},
      organization: null,
      telemetry: false,
      adoption: { durableTurns: { enabled: true } },
    });
    setAdoptionDbPool(pool as never);
  });

  afterEach(() => {
    setAdoptionDbPool(null);
  });

  it('duplicate idempotency key returns same journal entry without double insert', async () => {
    const journal = new CommandJournal();
    const first = await journal.receive('ws_chat_message', 'sess-1', { text: 'hi' }, 'dup-key-1');
    const second = await journal.receive('ws_chat_message', 'sess-1', { text: 'hi' }, 'dup-key-1');
    expect(second.id).toBe(first.id);
    expect(second.idempotencyKey).toBe('dup-key-1');

    await journal.complete('dup-key-1', { messageId: 'msg-1' });
    const completed = await journal.getByKey('dup-key-1');
    expect(completed?.status).toBe('completed');
    expect((completed?.result as { messageId?: string })?.messageId).toBe('msg-1');
  });
});
