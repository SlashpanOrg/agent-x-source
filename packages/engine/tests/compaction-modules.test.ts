import { describe, it, expect } from 'vitest';
import { CompactionSummarizer } from '../src/communication/CompactionSummarizer.js';
import { PostCompactionGuard } from '../src/communication/PostCompactionGuard.js';

describe('CompactionSummarizer', () => {
  const summarizer = new CompactionSummarizer();

  it('formats a summary with all sections', () => {
    const formatted = CompactionSummarizer.formatSummary({
      goal: 'Test goal',
      constraints: 'No constraints',
      done: ['Task 1', 'Task 2'],
      inProgress: ['Task 3'],
      blocked: [],
      keyDecisions: ['Used approach A'],
      nextSteps: ['Verify', 'Deploy'],
      criticalContext: ['Important note'],
      relevantFiles: ['src/index.ts'],
    });
    expect(formatted).toContain('Test goal');
    expect(formatted).toContain('Task 1');
    expect(formatted).toContain('Used approach A');
    expect(formatted).toContain('REFERENCE');
  });

  it('extracts goals from content', async () => {
    const result = await summarizer.summarize(
      [{ id: 'm1', sessionId: 's1', role: 'user' as const, content: 'I need to refactor the auth module to use JWT', toolCalls: null, tokenCount: 0, createdAt: '' }],
      [],
    );
    expect(result.goal).toBeTruthy();
  });
});

describe('PostCompactionGuard', () => {
  it('detects looping after repeated same-tool calls', () => {
    const guard = new PostCompactionGuard();
    guard.recordCompaction('s1');
    guard.recordToolCall('s1', 'file_read');
    guard.recordToolCall('s1', 'file_read');
    guard.recordToolCall('s1', 'file_read');
    expect(guard.isLooping('s1')).toBe(true);
  });

  it('resets per session', () => {
    const guard = new PostCompactionGuard();
    guard.recordCompaction('s1');
    guard.recordToolCall('s1', 'file_read');
    guard.clear('s1');
    expect(guard.isLooping('s1')).toBe(false);
  });
});
