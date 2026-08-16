/** Persisted article saved from chat or agent tools. */

import type { ArticleKind } from '../utils/article-kind.js';

export type ArticleFormat = ArticleKind;

export interface ArticleRecord {
  id: string;
  /** The session that created this article. Becomes null if that session is deleted, so the article survives. */
  sessionId: string | null;
  messageId?: string | null;
  title: string;
  excerpt: string;
  /** Relative path under data dir, e.g. `articles/{id}/content.md` */
  filePath: string;
  contentFormat: ArticleFormat;
  sourceRole?: 'user' | 'assistant' | 'system' | null;
  createdAt: string;
  updatedAt: string;
  /** Persisted list-section day key (`YYYY-MM-DD`), set at create — not recomputed in UI. */
  listDayKey?: string | null;
  /** Persisted absolute day label for list dividers. */
  listDayLabel?: string | null;
}

export interface CreateArticleInput {
  sessionId: string;
  title: string;
  messageId?: string;
  sourceRole?: 'user' | 'assistant' | 'system';
  content?: string;
  kind?: ArticleKind | string;
}

export interface ArticlePayload {
  record: ArticleRecord;
  content?: string;
}
