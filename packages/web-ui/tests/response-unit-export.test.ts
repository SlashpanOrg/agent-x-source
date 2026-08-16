import { describe, expect, it } from 'vitest';
import { messageToArticleContent } from '../src/articles/message-export';
import type { UIMessage } from '../src/chat/types';

describe('ResponseUnit article export', () => {
  it('prefers the rich document fallback over duplicate canonical text', () => {
    const message: UIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      content: 'Canonical answer that should not be duplicated.',
      parts: [{
        type: 'response_document',
        id: 'rich-1',
        fallbackMarkdown: '# Rich analysis\n\n- **42%** — Improvement',
        responseDocument: {
          version: 1,
          title: 'Rich analysis',
          density: 'compact',
          blocks: [{
            type: 'stat_grid',
            stats: [{ label: 'Improvement', value: '42%' }],
          }],
        },
      }],
    };

    const content = messageToArticleContent(message);
    expect(content).toContain('# Rich analysis');
    expect(content).toContain('42%');
    expect(content).not.toContain('Canonical answer that should not be duplicated');
  });

  it('falls back to ordinary message content when the document is invalid', () => {
    const message = {
      id: 'assistant-2',
      role: 'assistant',
      content: 'Safe canonical answer.',
      parts: [{
        type: 'response_document',
        id: 'rich-invalid',
        responseDocument: {
          version: 1,
          blocks: [{ type: 'iframe', src: 'https://example.com' }],
        },
      }],
    } as unknown as UIMessage;

    expect(messageToArticleContent(message)).toBe('Safe canonical answer.');
  });
});
