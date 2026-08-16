// Standalone HTML for Chromium printToPDF — vector output of the compiled article.

import { compileArticle } from '../compile';
import { colorTokensToHtml, renderArticleBodyHtml } from './article-html';

export { colorTokensToHtml };

/** Colour palette for the print template — dark canvas matching ArticleView. */
export const PRINT_COLORS = {
  bg: '#0a0a12',
  surface: '#12121c',
  border: '#242432',
  borderSubtle: '#181822',
  textPrimary: '#f2f3f7',
  textSecondary: '#b4b8c4',
  textDim: '#656878',
  accentBlue: '#7dd3fc',
  accentCyan: '#67e8f9',
  accentGreen: '#4ade80',
  accentPurple: '#c4b5fd',
  accentOrange: '#fbbf24',
  accentRed: '#f87171',
} as const;

export interface PrintHtmlMeta {
  createdAt?: string;
  sessionId?: string | null;
}

/**
 * Convert article content into a complete standalone HTML document
 * suitable for Chromium's `webContents.printToPDF()`.
 */
export function buildPrintHtml(content: string, title?: string, meta?: PrintHtmlMeta): string {
  const article = compileArticle({ content, title });
  const bodyHtml = renderArticleBodyHtml(article, meta);
  const safeTitle = article.title.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle}</title>
<style>
  @page {
    size: A4;
    margin: 16mm 14mm 18mm 14mm;
  }

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  html, body {
    background: ${PRINT_COLORS.bg};
    color: ${PRINT_COLORS.textSecondary};
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }

  .ax-article {
    max-width: 100%;
    border: 1px solid ${PRINT_COLORS.borderSubtle};
    border-radius: 12px;
    overflow: hidden;
    background: ${PRINT_COLORS.surface};
  }

  .ax-masthead {
    padding: 18px 20px 14px;
    border-bottom: 1px solid ${PRINT_COLORS.borderSubtle};
    background: linear-gradient(180deg, rgba(103, 232, 249, 0.08) 0%, transparent 100%);
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .ax-kicker {
    font-family: 'SF Mono', 'Fira Code', ui-monospace, monospace;
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: ${PRINT_COLORS.accentCyan};
    margin-bottom: 6px;
  }

  .ax-masthead h1 {
    font-size: 20px;
    font-weight: 720;
    color: ${PRINT_COLORS.textPrimary};
    letter-spacing: -0.03em;
    line-height: 1.25;
    margin: 0;
    text-transform: none;
    border: 0;
    padding: 0;
  }

  .ax-meta {
    margin-top: 8px;
    font-family: 'SF Mono', ui-monospace, monospace;
    font-size: 8px;
    color: ${PRINT_COLORS.textDim};
  }

  .ax-body {
    padding: 16px 20px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  h2 {
    font-size: 11px;
    font-weight: 700;
    color: ${PRINT_COLORS.textPrimary};
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 4px 0 2px;
    padding-bottom: 6px;
    border-bottom: 1px solid ${PRINT_COLORS.borderSubtle};
    break-after: avoid;
    page-break-after: avoid;
    break-inside: avoid;
  }

  h3, h4 {
    font-size: 12px;
    font-weight: 600;
    color: ${PRINT_COLORS.textPrimary};
    margin: 6px 0 2px;
    break-after: avoid;
    page-break-after: avoid;
    break-inside: avoid;
  }

  p {
    font-size: 11px;
    line-height: 1.6;
    color: ${PRINT_COLORS.textSecondary};
    orphans: 3;
    widows: 3;
  }

  ul, ol {
    padding-left: 20px;
  }

  li {
    margin-bottom: 4px;
    font-size: 11px;
    line-height: 1.5;
    color: ${PRINT_COLORS.textSecondary};
    break-inside: avoid;
    page-break-inside: avoid;
  }

  li::marker {
    color: ${PRINT_COLORS.accentCyan};
  }

  .check {
    color: ${PRINT_COLORS.accentGreen};
    margin-right: 4px;
  }

  blockquote {
    padding: 10px 14px;
    border-left: 3px solid ${PRINT_COLORS.accentBlue};
    background: rgba(125, 211, 252, 0.04);
    border-radius: 0 8px 8px 0;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .table-card {
    border: 1px solid ${PRINT_COLORS.borderSubtle};
    border-radius: 10px;
    overflow: hidden;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5px;
    break-inside: auto;
    page-break-inside: auto;
  }

  thead {
    display: table-header-group;
    break-inside: avoid;
    break-after: avoid;
  }

  th {
    text-align: left;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: ${PRINT_COLORS.textPrimary};
    background: ${PRINT_COLORS.bg};
    border-bottom: 1px solid ${PRINT_COLORS.border};
    padding: 7px 10px;
    font-family: 'SF Mono', ui-monospace, monospace;
    font-size: 8px;
  }

  td {
    border-bottom: 1px solid ${PRINT_COLORS.borderSubtle};
    padding: 7px 10px;
    color: ${PRINT_COLORS.textSecondary};
    vertical-align: top;
    font-variant-numeric: tabular-nums;
  }

  tbody tr:nth-child(even) td {
    background: rgba(255, 255, 255, 0.02);
  }

  tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  td:first-child {
    color: ${PRINT_COLORS.textPrimary};
    font-weight: 600;
  }

  code {
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace;
    font-size: 10px;
    background: ${PRINT_COLORS.bg};
    padding: 1px 5px;
    border-radius: 3px;
    color: ${PRINT_COLORS.accentCyan};
  }

  pre {
    background: ${PRINT_COLORS.bg};
    border: 1px solid ${PRINT_COLORS.borderSubtle};
    border-radius: 8px;
    padding: 12px 14px;
    overflow-x: auto;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  pre code {
    background: none;
    padding: 0;
    color: ${PRINT_COLORS.textSecondary};
    font-size: 10px;
    line-height: 1.5;
  }

  a {
    color: ${PRINT_COLORS.accentCyan};
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  hr {
    border: none;
    border-top: 1px solid ${PRINT_COLORS.borderSubtle};
  }

  strong {
    color: ${PRINT_COLORS.textPrimary};
    font-weight: 700;
  }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}
