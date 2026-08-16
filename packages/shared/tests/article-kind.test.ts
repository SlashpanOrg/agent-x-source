import { describe, expect, it } from 'vitest';
import {
  articleKindKicker,
  articleKindLabel,
  deriveArticleKind,
  isArticleKind,
} from '../src/utils/article-kind.js';

describe('article kinds', () => {
  it('accepts the four sidebar kinds', () => {
    expect(isArticleKind('article')).toBe(true);
    expect(isArticleKind('analysis')).toBe(true);
    expect(isArticleKind('report')).toBe(true);
    expect(isArticleKind('insight')).toBe(true);
    expect(isArticleKind('canvas')).toBe(false);
  });

  it('labels and kickers stay human-readable', () => {
    expect(articleKindLabel('analysis')).toBe('Analysis');
    expect(articleKindLabel('report')).toBe('Report');
    expect(articleKindLabel('insight')).toBe('Insight');
    expect(articleKindLabel('article')).toBe('Article');
    expect(articleKindKicker('report')).toBe('Report');
  });

  it('honors an explicit kind', () => {
    expect(deriveArticleKind({ kind: 'insight', title: 'Weekly report' })).toBe('insight');
  });

  it('infers report / analysis / insight from title or opening body', () => {
    expect(deriveArticleKind({ title: 'Lab report — lipids' })).toBe('report');
    expect(deriveArticleKind({ title: 'Deep dive on spend' })).toBe('analysis');
    expect(deriveArticleKind({ content: 'Key findings from the week' })).toBe('insight');
    expect(deriveArticleKind({ title: 'Notes from lunch' })).toBe('article');
  });
});
