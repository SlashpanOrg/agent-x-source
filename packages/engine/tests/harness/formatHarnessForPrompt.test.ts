import { describe, it, expect } from 'vitest';
import { formatHarnessForPrompt } from '../../src/harness/formatHarnessForPrompt.js';
import type { HarnessEntry } from '@agentx/shared';

function entry(kind: HarnessEntry['kind'], title: string, content: string): HarnessEntry {
  return {
    id: 'e1',
    kind,
    title,
    content,
    path: '',
    reference: {},
    arguments: {},
    metadata: {},
    source: 'test',
    scope: 'local',
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

describe('formatHarnessForPrompt', () => {
  it('returns empty string when no entries', () => {
    expect(formatHarnessForPrompt([], [])).toBe('');
  });

  it('caps content length and groups by kind', () => {
    const long = 'x'.repeat(300);
    const block = formatHarnessForPrompt([entry('memory', 'Note', long)], []);
    expect(block).toContain('CONTINUAL HARNESS');
    expect(block).toContain('Note');
    expect(block.length).toBeLessThan(long.length + 200);
  });

  it('includes global and session sections', () => {
    const block = formatHarnessForPrompt(
      [entry('memory', 'Local', 'local hint')],
      [entry('skill', 'Global skill', 'skill ref only')],
    );
    expect(block).toContain('local hint');
    expect(block).toContain('skill ref only');
  });
});
