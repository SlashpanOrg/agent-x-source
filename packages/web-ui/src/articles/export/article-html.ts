import type { ArticleBlock, CompiledArticle } from '../types';

const AXC_TOKEN_RE = /⟦axc:([^⟧]+)⟧([\s\S]*?)⟦\/axc⟧/g;

/** Turn internal color tokens into print-safe colored spans. */
export function colorTokensToHtml(html: string): string {
  return html.replace(
    AXC_TOKEN_RE,
    (_m, color: string, inner: string) =>
      `<span style="color:${color};font-weight:600;white-space:nowrap">${inner}</span>`,
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineHtml(text: string): string {
  const escaped = escapeHtml(prepareForPrint(text));
  return colorTokensToHtml(escaped)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function prepareForPrint(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function renderBlock(block: ArticleBlock): string {
  switch (block.type) {
    case 'heading': {
      const level = Math.min(4, Math.max(2, block.level));
      return `<h${level}>${inlineHtml(block.text)}</h${level}>`;
    }
    case 'paragraph':
      return `<p>${inlineHtml(block.text)}</p>`;
    case 'quote':
      return `<blockquote><p>${inlineHtml(block.text)}</p></blockquote>`;
    case 'hr':
      return '<hr />';
    case 'code':
      return `<pre><code class="language-${escapeHtml(block.language)}">${escapeHtml(block.code)}</code></pre>`;
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      const items = block.items.map((item) => {
        const mark = item.checked == null ? '' : `<span class="check">${item.checked ? '☑' : '☐'}</span> `;
        return `<li>${mark}${inlineHtml(item.text)}</li>`;
      }).join('');
      return `<${tag}>${items}</${tag}>`;
    }
    case 'table': {
      const align = (index: number) => block.align[index] ?? 'left';
      const head = block.headers.map((header, index) => (
        `<th style="text-align:${align(index)}">${inlineHtml(header)}</th>`
      )).join('');
      const body = block.rows.map((row) => {
        const cells = block.headers.map((_, index) => (
          `<td style="text-align:${align(index)}">${inlineHtml(String(row[index] ?? ''))}</td>`
        )).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      return `<div class="table-card"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    }
  }
}

export function renderArticleBodyHtml(article: CompiledArticle, meta?: {
  createdAt?: string;
  sessionId?: string | null;
}): string {
  const created = meta?.createdAt
    ? escapeHtml(new Date(meta.createdAt).toLocaleString())
    : '';
  const session = meta?.sessionId
    ? escapeHtml(`session ${meta.sessionId.slice(-8)}`)
    : '';
  const metaLine = [created, session].filter(Boolean).join(' · ');
  const blocks = article.blocks.map(renderBlock).join('\n');
  return `<article class="ax-article">
  <header class="ax-masthead">
    <div class="ax-kicker">${escapeHtml(article.kicker)}</div>
    <h1>${escapeHtml(article.title)}</h1>
    ${metaLine ? `<div class="ax-meta">${metaLine}</div>` : ''}
  </header>
  <div class="ax-body">
${blocks}
  </div>
</article>`;
}
