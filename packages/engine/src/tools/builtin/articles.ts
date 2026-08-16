import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { deriveArticleTitle } from '@agentx/shared';
import { getArticleStoreInstance } from '../../articles/ArticleStore.js';

/** Persist an article for reports, saved replies, and structured deliverables. */
export async function saveToArticle(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const store = getArticleStoreInstance();
  if (!store) {
    return { success: false, output: 'Article store not available', error: 'NOT_CONFIGURED' };
  }

  const content = String(args['content'] ?? '').trim();
  if (!content) {
    return { success: false, output: 'content is required', error: 'MISSING_PARAMS' };
  }

  const title = deriveArticleTitle({
    title: String(args['title'] ?? '').trim(),
    content,
  });
  const messageId = typeof args['message_id'] === 'string' ? args['message_id'] : undefined;
  const sourceRole = args['source_role'] as 'user' | 'assistant' | 'system' | undefined;
  const kind = typeof args['kind'] === 'string' ? args['kind'] : undefined;

  try {
    const record = await store.create({
      sessionId: context.sessionId,
      title,
      messageId,
      sourceRole,
      content,
      kind,
    });

    return {
      success: true,
      output: `${record.contentFormat === 'article' ? 'Article' : record.contentFormat[0]!.toUpperCase() + record.contentFormat.slice(1)} saved: "${record.title}" (id: ${record.id}). Open Articles in the sidebar to view or export as PDF.`,
      metadata: { articleId: record.id, sessionId: record.sessionId, contentFormat: record.contentFormat },
    };
  } catch (err) {
    return {
      success: false,
      output: err instanceof Error ? err.message : 'Failed to save article',
      error: 'SAVE_FAILED',
    };
  }
}

/** List saved articles from the sidebar (not the filesystem). */
export async function articleList(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const store = getArticleStoreInstance();
  if (!store) {
    return { success: false, output: 'Article store not available', error: 'NOT_CONFIGURED' };
  }

  const limit = typeof args['limit'] === 'number' ? args['limit'] : 50;
  const sessionOnly = args['session_only'] === true;

  try {
    const records = sessionOnly
      ? await store.listForSession(context.sessionId, limit)
      : await store.list(limit, 0);

    if (records.length === 0) {
      return { success: true, output: 'No saved articles found.' };
    }

    const lines = records.map((r, i) => {
      const date = String(r.createdAt).slice(0, 10);
      return `${i + 1}. **${r.title}** (${r.contentFormat}, id: \`${r.id}\`) — ${date}`;
    });
    return {
      success: true,
      output: `Found ${records.length} saved article(s):\n\n${lines.join('\n')}`,
      metadata: { count: records.length, ids: records.map((r) => r.id) },
    };
  } catch (err) {
    return {
      success: false,
      output: err instanceof Error ? err.message : 'Failed to list articles',
      error: 'LIST_FAILED',
    };
  }
}
