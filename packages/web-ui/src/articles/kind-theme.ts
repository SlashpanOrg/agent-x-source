import type { ArticleKind } from '@agentx/shared/browser';
import { colors } from '../theme';

export function articleKindAccent(kind: ArticleKind | undefined): string {
  if (kind === 'analysis') return colors.accent.blue;
  if (kind === 'report') return colors.accent.orange;
  if (kind === 'insight') return colors.accent.purple;
  return colors.accent.cyan;
}
