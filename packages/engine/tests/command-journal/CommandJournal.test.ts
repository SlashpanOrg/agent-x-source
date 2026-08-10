import { describe, it, expect } from 'vitest';
import { CommandJournal } from '../../src/command-journal/CommandJournal.js';

describe('CommandJournal', () => {
  it('is disabled without adoption pool', () => {
    const journal = new CommandJournal();
    expect(journal.isEnabled()).toBe(false);
  });

  it('receive returns in-memory entry when disabled', async () => {
    const journal = new CommandJournal();
    const entry = await journal.receive('chat_turn', 's1', { t: 1 }, 'key-1');
    expect(entry.status).toBe('received');
    expect(entry.idempotencyKey).toBe('key-1');
  });
});
