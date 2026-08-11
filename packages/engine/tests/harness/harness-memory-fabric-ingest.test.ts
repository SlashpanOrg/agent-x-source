import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configureAdoptionFromConfig, isHarnessMemoryFabricIngestEnabled } from '@agentx/shared';

describe('harness memory fabric ingest flag (X-INT-08)', () => {
  beforeEach(() => {
    configureAdoptionFromConfig({
      provider: { activeProvider: 'openai', activeModel: 'gpt-4', providers: {} },
      adoption: {
        harness: { enabled: true, memoryFabricIngest: false },
      },
    } as never);
  });

  it('defaults off until memoryFabricIngest is true', () => {
    expect(isHarnessMemoryFabricIngestEnabled()).toBe(false);
    configureAdoptionFromConfig({
      provider: { activeProvider: 'openai', activeModel: 'gpt-4', providers: {} },
      adoption: { harness: { enabled: true, memoryFabricIngest: true } },
    } as never);
    expect(isHarnessMemoryFabricIngestEnabled()).toBe(true);
  });

  it('skips ingest when flag disabled', async () => {
    const { ingestHarnessMemoryEntriesToFabric } = await import('../../src/harness/harness-memory-fabric-ingest.js');
    const count = await ingestHarnessMemoryEntriesToFabric([
      {
        id: 'm1',
        kind: 'memory',
        title: 'T',
        content: 'C',
        path: '',
        reference: {},
        arguments: {},
        metadata: {},
        source: 'test',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        version: 1,
      },
    ], 'sess-1');
    expect(count).toBe(0);
  });
});

describe('ingestHarnessMemoryEntriesToFabric with fabric', () => {
  it('creates nodes when enabled and fabric present', async () => {
    configureAdoptionFromConfig({
      provider: { activeProvider: 'openai', activeModel: 'gpt-4', providers: {} },
      adoption: { harness: { enabled: true, memoryFabricIngest: true } },
    } as never);

    const createNode = vi.fn().mockResolvedValue({ id: 'n1' });
    const hasTaggedMemory = vi.fn().mockResolvedValue(false);
    const { setMemoryFabricInstance } = await import('../../src/neural/MemoryFabric.js');
    setMemoryFabricInstance({
      createNode,
      hasTaggedMemory,
    } as never);

    const { ingestHarnessMemoryEntriesToFabric } = await import('../../src/harness/harness-memory-fabric-ingest.js');
    const count = await ingestHarnessMemoryEntriesToFabric([
      {
        id: 'm1',
        kind: 'memory',
        title: 'Note',
        content: 'Remember this',
        path: '',
        reference: {},
        arguments: {},
        metadata: {},
        source: 'test',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        version: 1,
      },
    ], 'sess-1');
    expect(count).toBe(1);
    expect(createNode).toHaveBeenCalled();
  });
});
