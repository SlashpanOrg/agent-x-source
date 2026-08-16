import type { UIMessage } from '../chat/types';
import {
  deriveArticleTitle,
  parseResponseDocument,
  responseDocumentToMarkdown,
  sanitizeArticleDeliverable,
} from '@agentx/shared/browser';
import { displayContent } from '../chat/utils';

/** Serialize a chat message into article source (preserves chart parts). */
export function messageToArticleContent(message: UIMessage): string {
  const chunks: string[] = [];
  const richPart = message.parts?.find((part) => (
    part.type === 'response_document'
    && parseResponseDocument(part.responseDocument).ok
  ));
  if (richPart?.type === 'response_document') {
    const parsed = parseResponseDocument(richPart.responseDocument);
    if (parsed.ok) {
      const rich = richPart.fallbackMarkdown?.trim()
        || responseDocumentToMarkdown(parsed.document);
      return sanitizeArticleDeliverable(rich);
    }
  }
  if (message.parts?.length) {
    for (const part of message.parts) {
      if (part.type === 'text' && part.content?.trim()) {
        chunks.push(part.content.trim());
      } else if (part.type === 'chart' && part.chartJson?.trim()) {
        chunks.push(`\`\`\`chart\n${part.chartJson.trim()}\n\`\`\``);
      }
    }
  }
  const fromParts = chunks.join('\n\n').trim();
  const raw = fromParts || displayContent(message);
  return sanitizeArticleDeliverable(raw);
}

/** Derive an article title from a chat message body. */
export function deriveArticleTitleFromMessage(message: UIMessage): string {
  const content = messageToArticleContent(message);
  return deriveArticleTitle({ content });
}
