/**
 * Compile a saved article into a structured AST.
 * The page and PDF render this AST — never the raw GFM pipe dump.
 */

import { marked, type Tokens } from 'marked';
import {
  displayArticleTitle,
  isGfmTableSeparator,
  parseGfmTableCells,
} from '@agentx/shared/browser';
import { prepareArticleSource } from './prepare';
import type {
  ArticleAlign,
  ArticleBlock,
  CompileArticleInput,
  CompiledArticle,
} from './types';

function inlineText(token: { text?: string; tokens?: Tokens.Generic[] }): string {
  if (token.tokens?.length) {
    return token.tokens.map((child) => inlineText(child)).join('');
  }
  return token.text ?? '';
}

function asAlign(value: 'center' | 'left' | 'right' | null | undefined): ArticleAlign {
  if (value === 'center' || value === 'right') return value;
  return 'left';
}

function tableFromToken(token: Tokens.Table): Extract<ArticleBlock, { type: 'table' }> {
  const headers = token.header.map((cell) => (cell.text ?? inlineText(cell)).trim());
  const align = token.align.map((value) => asAlign(value));
  while (align.length < headers.length) align.push('left');
  const rows = token.rows.map((row) => {
    const cells = row.map((cell) => (cell.text ?? inlineText(cell)).trim());
    while (cells.length < headers.length) cells.push('');
    return cells.slice(0, Math.max(headers.length, cells.length));
  });
  return { type: 'table', headers, align: align.slice(0, headers.length), rows };
}

function listFromToken(token: Tokens.List): Extract<ArticleBlock, { type: 'list' }> {
  return {
    type: 'list',
    ordered: token.ordered,
    items: token.items.map((item) => {
      const text = (item.text || inlineText(item)).replace(/\n+/g, ' ').trim();
      if (item.task) {
        return { text, checked: !!item.checked };
      }
      return { text };
    }),
  };
}

function tokensToBlocks(tokens: Tokens.Generic[]): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const text = inlineText(token).trim();
        if (text) {
          blocks.push({
            type: 'heading',
            level: Math.min(6, Math.max(1, Number(token.depth) || 1)),
            text,
          });
        }
        break;
      }
      case 'paragraph':
      case 'text': {
        const text = (token.text || inlineText(token)).trim();
        if (text) blocks.push({ type: 'paragraph', text });
        break;
      }
      case 'table':
        blocks.push(tableFromToken(token as Tokens.Table));
        break;
      case 'list':
        blocks.push(listFromToken(token as Tokens.List));
        break;
      case 'blockquote': {
        const text = inlineText(token).trim() || String(token.text ?? '').trim();
        if (text) blocks.push({ type: 'quote', text });
        break;
      }
      case 'code':
        blocks.push({
          type: 'code',
          language: String(token.lang || 'text').toLowerCase(),
          code: String(token.text ?? ''),
        });
        break;
      case 'hr':
        blocks.push({ type: 'hr' });
        break;
      case 'space':
        break;
      case 'html': {
        const text = String(token.text ?? '').trim();
        if (text) blocks.push({ type: 'paragraph', text });
        break;
      }
      default:
        if (Array.isArray(token.tokens) && token.tokens.length) {
          blocks.push(...tokensToBlocks(token.tokens as Tokens.Generic[]));
        } else if (typeof token.text === 'string' && token.text.trim()) {
          blocks.push({ type: 'paragraph', text: token.text.trim() });
        }
        break;
    }
  }
  return blocks;
}

function titlesMatch(left: string, right: string): boolean {
  const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
  return Boolean(norm(left)) && norm(left) === norm(right);
}

function skipDuplicateTitle(blocks: ArticleBlock[], title: string): ArticleBlock[] {
  if (!blocks[0] || blocks[0].type !== 'heading' || blocks[0].level > 2) return blocks;
  if (!titlesMatch(blocks[0].text, title)) return blocks;
  return blocks.slice(1);
}

function looksLikePipeDump(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('|') && trimmed.includes('|');
}

function alignFromSeparator(cell: string): ArticleAlign {
  const trimmed = cell.trim();
  if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
  if (trimmed.endsWith(':')) return 'right';
  return 'left';
}

function parseTablesFromMarkdown(markdown: string): Array<Extract<ArticleBlock, { type: 'table' }>> {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const tables: Array<Extract<ArticleBlock, { type: 'table' }>> = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    const next = lines[index + 1];
    if (
      !isGfmTableSeparator(line)
      && line.trim().startsWith('|')
      && next
      && isGfmTableSeparator(next)
    ) {
      const headers = parseGfmTableCells(line);
      const alignCells = parseGfmTableCells(next);
      const align = headers.map((_, col) => alignFromSeparator(alignCells[col] ?? '---'));
      const rows: string[][] = [];
      let cursor = index + 2;
      while (
        cursor < lines.length
        && lines[cursor]!.trim().startsWith('|')
        && !isGfmTableSeparator(lines[cursor]!)
      ) {
        const cells = parseGfmTableCells(lines[cursor]!);
        rows.push(headers.map((_, col) => cells[col] ?? ''));
        cursor += 1;
      }
      if (headers.length >= 2) {
        tables.push({ type: 'table', headers, align, rows });
      }
      index = cursor;
      continue;
    }
    index += 1;
  }
  return tables;
}

export function compileArticle(input: CompileArticleInput | string, titleArg?: string): CompiledArticle {
  const content = typeof input === 'string' ? input : input.content;
  const title = typeof input === 'string' ? titleArg : input.title;
  const kicker = typeof input === 'string' ? 'Article' : (input.kicker ?? 'Article');

  const prepared = prepareArticleSource(content, title);
  marked.setOptions({ gfm: true, breaks: false, async: false });
  const tokens = marked.lexer(prepared) as Tokens.Generic[];
  let blocks = skipDuplicateTitle(tokensToBlocks(tokens), displayArticleTitle(title ?? '') || title || '');

  if (!blocks.some((block) => block.type === 'table')) {
    const fallback = parseTablesFromMarkdown(prepared);
    if (fallback.length) {
      const rest = blocks.filter((block) => block.type !== 'paragraph' || !looksLikePipeDump(block.text));
      blocks = [...fallback, ...rest];
    }
  }

  blocks = blocks.filter((block) => {
    if (block.type !== 'paragraph') return true;
    const trimmed = block.text.trim();
    if (/^\|?\s*:?-{2,}[-:|\s]*\|?\s*$/.test(trimmed)) return false;
    if (looksLikePipeDump(trimmed) && blocks.some((candidate) => candidate.type === 'table')) {
      return false;
    }
    return true;
  });

  const displayTitle = displayArticleTitle(title ?? '')
    || blocks.find((block): block is Extract<ArticleBlock, { type: 'heading' }> => block.type === 'heading')?.text
    || 'Article';

  return {
    title: displayTitle,
    kicker,
    blocks: skipDuplicateTitle(blocks, displayTitle),
    sourceContent: prepared,
  };
}

export function articleHasTable(article: CompiledArticle): boolean {
  return article.blocks.some((block) => block.type === 'table');
}
