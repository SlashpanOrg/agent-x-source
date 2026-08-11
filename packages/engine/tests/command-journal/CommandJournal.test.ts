import { describe, it, expect, afterEach } from 'vitest';
import { configureAdoptionFromConfig, setAdoptionTurnOverrides } from '@agentx/shared';
import { CommandJournal } from '../../src/command-journal/CommandJournal.js';

describe('CommandJournal', () => {
  afterEach(() => {
    setAdoptionTurnOverrides(null);
    configureAdoptionFromConfig(null);
  });

  it('can be disabled via turn override', () => {
    setAdoptionTurnOverrides({ durableTurns: false });
    const journal = new CommandJournal();
    expect(journal.isEnabled()).toBe(false);
  });

  it('receive returns in-memory entry when disabled', async () => {
    setAdoptionTurnOverrides({ durableTurns: false });
    const journal = new CommandJournal();
    const entry = await journal.receive('chat_turn', 's1', { t: 1 }, 'key-1');
    expect(entry.status).toBe('received');
    expect(entry.idempotencyKey).toBe('key-1');
  });
});
