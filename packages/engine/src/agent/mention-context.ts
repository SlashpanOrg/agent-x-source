/** Composer `@article[id:title]` / `@session[id:title]` — pin saved docs and other chats. */

export const ARTICLE_MENTION_BODY_MAX = 12_000;
export const SESSION_MESSAGE_BODY_MAX = 800;
export const SESSION_MESSAGE_LIMIT = 16;

export type MentionedArticle = { articleId: string; title: string };
export type MentionedSession = { sessionId: string; title: string };

export type LoadedArticle = {
  title: string;
  kind?: string;
  content: string;
};

export type LoadedSession = {
  title: string;
  messages: Array<{ role: string; content: string }>;
};

function decodeLabel(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function parseIdNameMentions(
  content: string,
  prefix: 'article' | 'session',
): Array<{ id: string; name: string }> {
  const out: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();
  const re = new RegExp(`@${prefix}\\[([^:\\]]+):([^\\]]+)\\]`, 'g');
  for (const match of content.replace(/\u200b/g, '').matchAll(re)) {
    const id = match[1]!.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: decodeLabel(match[2]!) });
  }
  return out;
}

export function parseArticleMentions(content: string): MentionedArticle[] {
  return parseIdNameMentions(content, 'article').map((m) => ({
    articleId: m.id,
    title: m.name,
  }));
}

export function parseSessionMentions(content: string): MentionedSession[] {
  return parseIdNameMentions(content, 'session').map((m) => ({
    sessionId: m.id,
    title: m.name,
  }));
}

export function truncatePinnedText(text: string, max: number): string {
  const trimmed = text.replace(/\u200b/g, '').trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}\n…[truncated]`;
}

export function messageTextFromRow(row: Record<string, unknown>): string {
  const content = row['content'];
  if (typeof content === 'string' && content.trim()) return content;
  const parts = row['parts'];
  if (!Array.isArray(parts)) return typeof content === 'string' ? content : '';
  const texts: string[] = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      texts.push(part);
      continue;
    }
    if (!part || typeof part !== 'object') continue;
    const rec = part as Record<string, unknown>;
    if (typeof rec['text'] === 'string') texts.push(rec['text']);
  }
  return texts.join('\n');
}

export async function buildMentionContextBlock(input: {
  userText: string;
  currentSessionId?: string | null;
  loadArticle?: (id: string) => Promise<LoadedArticle | null>;
  loadSession?: (id: string) => Promise<LoadedSession | null>;
}): Promise<string> {
  const articles = parseArticleMentions(input.userText);
  const sessions = parseSessionMentions(input.userText)
    .filter((s) => s.sessionId !== input.currentSessionId);
  if (articles.length === 0 && sessions.length === 0) return '';

  const parts: string[] = [];

  for (const article of articles) {
    const loaded = input.loadArticle ? await input.loadArticle(article.articleId) : null;
    if (!loaded) {
      parts.push(
        `[PINNED ARTICLE]\nid=${article.articleId}\ntitle=${article.title}\n(content unavailable)\n[/PINNED ARTICLE]`,
      );
      continue;
    }
    parts.push(
      [
        '[PINNED ARTICLE]',
        `id=${article.articleId}`,
        `kind=${loaded.kind ?? 'article'}`,
        `title=${loaded.title || article.title}`,
        '',
        truncatePinnedText(loaded.content, ARTICLE_MENTION_BODY_MAX),
        '[/PINNED ARTICLE]',
      ].join('\n'),
    );
  }

  for (const session of sessions) {
    const loaded = input.loadSession ? await input.loadSession(session.sessionId) : null;
    if (!loaded) {
      parts.push(
        `[PINNED SESSION]\nid=${session.sessionId}\ntitle=${session.title}\n(transcript unavailable)\n[/PINNED SESSION]`,
      );
      continue;
    }
    const lines = loaded.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-SESSION_MESSAGE_LIMIT)
      .map((m) => `${m.role}: ${truncatePinnedText(m.content, SESSION_MESSAGE_BODY_MAX)}`);
    parts.push(
      [
        '[PINNED SESSION]',
        `id=${session.sessionId}`,
        `title=${loaded.title || session.title}`,
        '',
        lines.join('\n\n') || '(no messages)',
        '[/PINNED SESSION]',
      ].join('\n'),
    );
  }

  return parts.join('\n\n');
}
