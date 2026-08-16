/** Structured article produced by the articles module. Chat bubbles do not use this. */

export type ArticleAlign = 'left' | 'center' | 'right';

export type ArticleListItem = {
  text: string;
  checked?: boolean;
};

export type ArticleBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | {
    type: 'table';
    headers: string[];
    align: ArticleAlign[];
    rows: string[][];
  }
  | { type: 'list'; ordered: boolean; items: ArticleListItem[] }
  | { type: 'quote'; text: string }
  | { type: 'code'; language: string; code: string }
  | { type: 'hr' };

export interface CompiledArticle {
  title: string;
  kicker: string;
  blocks: ArticleBlock[];
  sourceContent: string;
}

export interface CompileArticleInput {
  content: string;
  title?: string;
  kicker?: string;
}

export interface ArticleMeta {
  createdAt?: string;
  sessionId?: string | null;
}
