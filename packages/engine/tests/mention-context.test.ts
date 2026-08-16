import { describe, expect, it, vi } from 'vitest';
import {
  buildMentionContextBlock,
  messageTextFromRow,
  parseArticleMentions,
  parseSessionMentions,
  truncatePinnedText,
} from '../src/agent/mention-context.js';

describe('mention context', () => {
  it('parses article and session tokens', () => {
    const text = 'Compare @article[art-1:Diet%20plan] with @session[ses-9:Kitchen%20chat]';
    expect(parseArticleMentions(text)).toEqual([{ articleId: 'art-1', title: 'Diet plan' }]);
    expect(parseSessionMentions(text)).toEqual([{ sessionId: 'ses-9', title: 'Kitchen chat' }]);
  });

  it('dedupes repeated mentions', () => {
    const text = '@article[art-1:One] and @article[art-1:One] again';
    expect(parseArticleMentions(text)).toHaveLength(1);
  });

  it('reads message text from content or parts', () => {
    expect(messageTextFromRow({ content: 'hello' })).toBe('hello');
    expect(messageTextFromRow({
      content: '',
      parts: [{ type: 'text', text: 'from parts' }],
    })).toBe('from parts');
  });

  it('truncates long pinned bodies', () => {
    expect(truncatePinnedText('abc', 8)).toBe('abc');
    expect(truncatePinnedText('abcdefghij', 4)).toBe('abcd\n…[truncated]');
  });

  it('pins article body and skips the current session', async () => {
    const loadArticle = vi.fn(async () => ({
      title: 'Diet plan',
      kind: 'report',
      content: '## Breakfast\nOats',
    }));
    const loadSession = vi.fn(async () => ({
      title: 'Should not load',
      messages: [{ role: 'user', content: 'secret' }],
    }));

    const block = await buildMentionContextBlock({
      userText: 'Use @article[art-1:Diet%20plan] and @session[self:This%20chat]',
      currentSessionId: 'self',
      loadArticle,
      loadSession,
    });

    expect(loadArticle).toHaveBeenCalledWith('art-1');
    expect(loadSession).not.toHaveBeenCalled();
    expect(block).toContain('[PINNED ARTICLE]');
    expect(block).toContain('kind=report');
    expect(block).toContain('## Breakfast');
    expect(block).not.toContain('[PINNED SESSION]');
  });

  it('pins another session transcript', async () => {
    const block = await buildMentionContextBlock({
      userText: 'Continue from @session[other:Kitchen]',
      currentSessionId: 'self',
      loadSession: async () => ({
        title: 'Kitchen',
        messages: [
          { role: 'user', content: 'What should I cook?' },
          { role: 'assistant', content: 'Try oats and fruit.' },
          { role: 'tool', content: 'ignored' },
        ],
      }),
    });

    expect(block).toContain('[PINNED SESSION]');
    expect(block).toContain('title=Kitchen');
    expect(block).toContain('user: What should I cook?');
    expect(block).toContain('assistant: Try oats and fruit.');
    expect(block).not.toContain('ignored');
  });

  it('notes unavailable pins without throwing', async () => {
    const block = await buildMentionContextBlock({
      userText: 'See @article[missing:Gone]',
      loadArticle: async () => null,
    });
    expect(block).toContain('content unavailable');
  });
});
