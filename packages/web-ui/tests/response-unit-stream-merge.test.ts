import { describe, expect, it } from 'vitest';
import { mergeActiveTurnResponseParts, mergeIncomingMessageParts } from '../src/chat/utils';
import type { PartEntry } from '../src/chat/types';

describe('response document stream merge', () => {
  it('preserves chronological workflow parts when the final rich snapshot arrives', () => {
    const previous: PartEntry[] = [
      { type: 'thinking', id: 'thought-1', content: 'Checked the evidence.' },
      {
        type: 'tool',
        id: 'tool-1',
        tool: { id: 'tool-1', name: 'web_search', status: 'done', result: 'ok' },
      },
      { type: 'text', id: 'text-1', content: 'Canonical answer' },
    ];
    const incoming: PartEntry[] = [{
      type: 'response_document',
      id: 'response-message-1',
      fallbackMarkdown: 'Canonical answer',
      responseDocument: {
        version: 1,
        revision: 1,
        density: 'compact',
        title: 'Analysis',
        blocks: [{ type: 'text', content: 'Canonical answer' }],
      },
    }];

    const merged = mergeIncomingMessageParts(previous, incoming) ?? [];
    expect(merged.map((part) => part.type)).toEqual([
      'thinking',
      'tool',
      'response_document',
    ]);
  });

  it('replaces a matching prior snapshot while retaining other parts', () => {
    const previous: PartEntry[] = [
      { type: 'thinking', id: 'thought-1', content: 'Done.' },
      {
        type: 'response_document',
        id: 'response-message-1',
        responseDocument: {
          version: 1,
          revision: 1,
          density: 'compact',
          blocks: [{ type: 'text', content: 'Old' }],
        },
      },
    ];
    const incoming: PartEntry[] = [{
      type: 'response_document',
      id: 'response-message-1',
      responseDocument: {
        version: 1,
        revision: 2,
        density: 'compact',
        blocks: [{ type: 'text', content: 'New' }],
      },
    }];
    const merged = mergeIncomingMessageParts(previous, incoming) ?? [];
    expect(merged.filter((part) => part.type === 'response_document')).toHaveLength(1);
    expect(merged.find((part) => part.type === 'response_document')?.responseDocument?.revision).toBe(2);
  });

  it('does not replace existing dedicated structured components', () => {
    const dedicatedTypes: PartEntry['type'][] = [
      'thinking',
      'tool',
      'subagent',
      'questionnaire',
      'crew_roster_picker',
      'deep_search',
      'chart',
      'permission',
    ];
    const previous = dedicatedTypes.map((type, index) => ({
      type,
      id: `${type}-${index}`,
    })) as PartEntry[];
    const incoming: PartEntry[] = [{
      type: 'response_document',
      id: 'response-message-1',
      responseDocument: {
        version: 1,
        revision: 1,
        density: 'compact',
        blocks: [{ type: 'text', content: 'Final answer' }],
      },
    }];
    const merged = mergeIncomingMessageParts(previous, incoming) ?? [];
    expect(merged.map((part) => part.type)).toEqual([
      ...dedicatedTypes,
      'response_document',
    ]);
  });

  it('preserves a stored rich snapshot when restart telemetry rebuilds the same reply', () => {
    const stored: PartEntry[] = [{
      type: 'response_document',
      id: 'response-message-1',
      responseDocument: {
        version: 1,
        revision: 2,
        density: 'compact',
        blocks: [{ type: 'text', content: 'Restored final answer' }],
      },
    }];
    const live: PartEntry[] = [{ type: 'thinking', id: 'thought-live', content: 'Recovered thought' }];
    expect(mergeActiveTurnResponseParts(stored, live, true)?.map((part) => part.type)).toEqual([
      'thinking',
      'response_document',
    ]);
    expect(mergeActiveTurnResponseParts(stored, live, false)).toEqual(live);
  });
});
