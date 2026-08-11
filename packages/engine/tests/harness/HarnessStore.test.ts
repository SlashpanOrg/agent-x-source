import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HarnessStore } from '../../src/harness/HarnessStore.js';

describe('HarnessStore', () => {
  const dir = join(tmpdir(), `agentx-harness-store-${Date.now()}`);
  const prev = process.env['AGENTX_DATA_DIR'];

  beforeEach(() => {
    process.env['AGENTX_DATA_DIR'] = dir;
    mkdirSync(join(dir, 'sessions', 'sess-h', 'harness'), { recursive: true });
  });

  afterEach(() => {
    if (prev) process.env['AGENTX_DATA_DIR'] = prev;
    else delete process.env['AGENTX_DATA_DIR'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads empty state and upserts entries on file backend', async () => {
    const store = new HarnessStore();
    const sessionId = 'sess-h';
    const state = await store.readState('local', sessionId);
    expect(state.entries.memory).toEqual({});

    const entry = await store.upsertEntry('local', sessionId, {
      id: 'm1',
      kind: 'memory',
      title: 'Note',
      content: 'hello',
      path: '',
      reference: {},
      arguments: {},
      metadata: {},
      source: 'test',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    });
    expect(entry.title).toBe('Note');
    const listed = store.listEntries('local', sessionId, 'memory');
    expect(listed.length).toBe(1);
  });
});
