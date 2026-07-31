// print-template.ts — Builds a standalone HTML document for Chromium's
// printToPDF engine. Produces vector PDFs (selectable text, crisp shapes)
// instead of rasterized images.
//
// The template flattens the themed React UI into print-safe inline CSS.
// Page breaks are controlled via CSS `break-inside: avoid` on block elements.

import { marked } from 'marked';

/** Colour palette for the print template — dark theme on white-safe paper. */
const PRINT_COLORS = {
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

/**
 * Convert a markdown string into a complete standalone HTML document
 * suitable for Chromium's `webContents.printToPDF()`.
 *
 * The document includes:
 * - Inline CSS (no external dependencies — works in offscreen BrowserWindow)
 * - Print-optimized dark theme matching the on-screen MarkdownContent styling
 * - `break-inside: avoid` on cards, tables, code blocks, blockquotes
 * - `break-after: avoid` on headings (keeps heading with following content)
 * - `print-color-adjust: exact` to preserve background colours
 * - A4 page size with 24pt margins
 */
export function buildPrintHtml(markdown: string, title?: string): string {
  // Configure marked for GFM (tables, strikethrough, task lists)
  marked.setOptions({
    gfm: true,
    breaks: false,
  });

  const bodyHtml = marked.parse(markdown) as string;
  const safeTitle = (title || 'Document').replace(/[<>&"']/g, (c) => {
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
  /* ─── Page setup ─── */
  @page {
    size: A4;
    margin: 24pt 24pt 24pt 24pt;
  }

  /* ─── Base reset ─── */
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

  /* ─── Content container ─── */
  .print-root {
    max-width: 100%;
    padding: 0;
  }

  /* ─── Typography ─── */
  h1 {
    font-size: 18px;
    font-weight: 700;
    color: ${PRINT_COLORS.textPrimary};
    letter-spacing: -0.02em;
    margin-bottom: 12px;
    margin-top: 0;
    break-after: avoid;
    break-inside: avoid;
  }

  h2 {
    font-size: 14px;
    font-weight: 700;
    color: ${PRINT_COLORS.textPrimary};
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-top: 20px;
    margin-bottom: 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid ${PRINT_COLORS.borderSubtle};
    break-after: avoid;
    break-inside: avoid;
  }

  h3, h4 {
    font-size: 13px;
    font-weight: 600;
    color: ${PRINT_COLORS.textPrimary};
    margin-top: 16px;
    margin-bottom: 8px;
    break-after: avoid;
    break-inside: avoid;
  }

  h5, h6 {
    font-size: 12px;
    font-weight: 600;
    color: ${PRINT_COLORS.textPrimary};
    margin-top: 12px;
    margin-bottom: 6px;
    break-after: avoid;
    break-inside: avoid;
  }

  p {
    margin-bottom: 10px;
    font-size: 11px;
    line-height: 1.6;
    color: ${PRINT_COLORS.textSecondary};
  }

  /* ─── Lists ─── */
  ul, ol {
    padding-left: 24px;
    margin-top: 6px;
    margin-bottom: 8px;
  }

  li {
    margin-bottom: 5px;
    font-size: 11px;
    line-height: 1.5;
    color: ${PRINT_COLORS.textSecondary};
    break-inside: avoid;
  }

  li::marker {
    color: ${PRINT_COLORS.accentCyan};
  }

  /* ─── Task list checkboxes ─── */
  li input[type="checkbox"] {
    margin-right: 6px;
    accent-color: ${PRINT_COLORS.accentBlue};
  }

  /* ─── Blockquotes / callouts ─── */
  blockquote {
    margin: 12px 0;
    padding: 10px 16px;
    border-left: 3px solid ${PRINT_COLORS.accentBlue};
    background: rgba(125, 211, 252, 0.04);
    border-radius: 0 6px 6px 0;
    break-inside: avoid;
  }

  blockquote p {
    margin-bottom: 0;
    color: ${PRINT_COLORS.textSecondary};
  }

  blockquote p:last-child {
    margin-bottom: 0;
  }

  /* ─── Tables ─── */
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
    margin: 12px 0;
    break-inside: auto;
  }

  thead {
    break-inside: avoid;
    break-after: avoid;
  }

  th {
    text-align: left;
    font-weight: 600;
    color: ${PRINT_COLORS.textPrimary};
    background: ${PRINT_COLORS.surface};
    border-bottom: 1px solid ${PRINT_COLORS.border};
    padding: 6px 10px;
  }

  td {
    border-bottom: 1px solid ${PRINT_COLORS.borderSubtle};
    padding: 6px 10px;
    color: ${PRINT_COLORS.textSecondary};
    vertical-align: top;
  }

  tr {
    break-inside: avoid;
  }

  /* ─── Code ─── */
  code {
    font-family: 'JetBrains Mono', 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 10px;
    background: ${PRINT_COLORS.surface};
    padding: 1px 5px;
    border-radius: 3px;
    color: ${PRINT_COLORS.accentCyan};
  }

  pre {
    background: ${PRINT_COLORS.surface};
    border: 1px solid ${PRINT_COLORS.borderSubtle};
    border-radius: 6px;
    padding: 12px 14px;
    overflow-x: auto;
    margin: 10px 0;
    break-inside: avoid;
  }

  pre code {
    background: none;
    padding: 0;
    color: ${PRINT_COLORS.textSecondary};
    font-size: 10px;
    line-height: 1.5;
  }

  /* ─── Links ─── */
  a {
    color: ${PRINT_COLORS.accentCyan};
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  /* ─── Horizontal rule ─── */
  hr {
    border: none;
    border-top: 1px solid ${PRINT_COLORS.borderSubtle};
    margin: 16px 0;
    break-after: avoid;
  }

  /* ─── Images ─── */
  img {
    max-width: 100%;
    height: auto;
    break-inside: avoid;
  }

  /* ─── Strong / emphasis ─── */
  strong {
    color: ${PRINT_COLORS.textPrimary};
    font-weight: 700;
  }

  em {
    color: ${PRINT_COLORS.textSecondary};
    font-style: italic;
  }

  /* ─── First/last child spacing ─── */
  .print-root > *:first-child {
    margin-top: 0;
  }

  .print-root > *:last-child {
    margin-bottom: 0;
  }

  /* ─── Card-like divs (if markdown contains raw HTML divs) ─── */
  .print-root div {
    break-inside: avoid;
  }
</style>
</head>
<body>
  <div class="print-root">
${bodyHtml}
  </div>
</body>
</html>`;
}
