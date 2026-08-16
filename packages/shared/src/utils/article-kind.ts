export const ARTICLE_KINDS = ['article', 'analysis', 'report', 'insight'] as const;
export type ArticleKind = (typeof ARTICLE_KINDS)[number];

const KIND_SET = new Set<string>(ARTICLE_KINDS);

export function isArticleKind(value: unknown): value is ArticleKind {
  return typeof value === 'string' && KIND_SET.has(value);
}

export function articleKindLabel(kind: ArticleKind): string {
  if (kind === 'analysis') return 'Analysis';
  if (kind === 'report') return 'Report';
  if (kind === 'insight') return 'Insight';
  return 'Article';
}

export function articleKindKicker(kind: ArticleKind): string {
  if (kind === 'analysis') return 'Analysis';
  if (kind === 'report') return 'Report';
  if (kind === 'insight') return 'Insight';
  return 'Article';
}

/** Infer a sidebar kind from an explicit value, title, or opening body. */
export function deriveArticleKind(input: {
  kind?: string | null;
  title?: string | null;
  content?: string | null;
}): ArticleKind {
  if (isArticleKind(input.kind)) return input.kind;
  const hay = `${input.title ?? ''}\n${(input.content ?? '').slice(0, 1200)}`.toLowerCase();
  if (/\b(insight|takeaway|key findings?|what this means)\b/.test(hay)) return 'insight';
  if (/\b(report|audit|lab report|status report|findings report|nutrition plan)\b/.test(hay)) return 'report';
  if (/\b(analys[ie]s|breakdown|deep dive|assessment|evaluation)\b/.test(hay)) return 'analysis';
  return 'article';
}
