import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { configureAdoptionFromConfig } from '@agentx/shared';
import { setAdoptionDbPool } from '../../src/adoption/adoption-db.js';
import { RunStateManager } from '../../src/agent/RunStateManager.js';
import { SessionAlreadyActiveError } from '../../src/session-lease/errors.js';
import { AdoptionFakePgPool } from './adoption-fake-pg.js';

describe('Phase 2 session lease integration', () => {
  const pool = new AdoptionFakePgPool();

  beforeEach(() => {
    configureAdoptionFromConfig({
      provider: { activeProvider: 'openai', activeModel: 'gpt-4' },
      ui: {},
      organization: null,
      telemetry: false,
      adoption: { sessionLease: { enabled: true } },
    });
    setAdoptionDbPool(pool as never);
  });

  afterEach(() => {
    setAdoptionDbPool(null);
  });

  it('blocks concurrent ensureRunning from web and electron clients on shared server', async () => {
    const web = new RunStateManager('ui:web');
    const electron = new RunStateManager('ui:electron');
    await web.ensureRunning('sess-shared');
    await expect(electron.ensureRunning('sess-shared')).rejects.toBeInstanceOf(SessionAlreadyActiveError);
    web.release('sess-shared');
  });

  it('uses distinct lease owner namespaces for channel agents', async () => {
    const telegram = new RunStateManager('channel:telegram');
    const slack = new RunStateManager('channel:slack');
    await telegram.ensureRunning('channel:telegram');
    await slack.ensureRunning('channel:slack');
    expect(telegram.isRunning('channel:telegram')).toBe(true);
    expect(slack.isRunning('channel:slack')).toBe(true);
    telegram.release('channel:telegram');
    slack.release('channel:slack');
  });
});
