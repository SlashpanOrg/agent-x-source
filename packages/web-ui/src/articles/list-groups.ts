import type { ArticleRecord } from '../api';
import { groupByPersistedListDay } from '../list-day-groups';

export interface ArticleDayGroup {
  dayKey: string;
  label: string;
  items: ArticleRecord[];
}

/** Group articles by persisted list-day fields (newest day first when list is DESC). */
export function groupArticlesByDay(items: ArticleRecord[]): ArticleDayGroup[] {
  return groupByPersistedListDay(items);
}
