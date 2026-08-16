/**
 * Articles module.
 *
 * Dedicated engine for sidebar saved articles: compile source into a
 * structured article, render a designed HTML/CSS page, and export that page
 * as a vector PDF. Chat bubbles keep CrewAwareMarkdown; this module does not
 * render or download raw GFM.
 */

export type {
  ArticleAlign,
  ArticleBlock,
  ArticleListItem,
  CompileArticleInput,
  ArticleMeta,
  CompiledArticle,
} from './types';

export { compileArticle, articleHasTable } from './compile';
export { prepareArticleSource, repairArticleTables } from './prepare';

export { ArticlePage } from './view/ArticlePage';
export { ArticleView } from './view/ArticleView';

export { buildPrintHtml, colorTokensToHtml, PRINT_COLORS } from './export/print-html';
export type { PrintHtmlMeta } from './export/print-html';
export { renderArticleContentToVectorPdf, renderArticleToVectorPdf } from './export/vector-pdf';
export { exportArticleToPdfBlob, savePdfBlob } from './export/pdf';
export type { ArticlePdfSaveOptions } from './export/pdf';
