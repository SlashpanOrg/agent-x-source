/**
 * Vector article → PDF (jsPDF text + tables). Used when Chromium printToPDF
 * is unavailable (browser) or fails. Draws the compiled article AST — never
 * rasterizes, never dumps leftover GFM pipes as a paragraph.
 */

import { jsPDF } from 'jspdf';
import { splitColoredMarkup } from '../../chat/assistant-markup';
import { compileArticle } from '../compile';
import type { ArticleBlock, CompiledArticle } from '../types';
import { PRINT_COLORS } from './print-html';

const PAGE_MARGIN = 48;
const FOOTER_GAP = 28;
const BODY_SIZE = 10;
const LINE = 14;
const TABLE_SIZE = 8;
const TABLE_LINE = 11;
const CELL_PAD_X = 5;
const CELL_PAD_Y = 4;

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = Number.parseInt(full.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function plainCell(raw: string): string {
  return splitColoredMarkup(raw).map((seg) => seg.text).join('').replace(/\s+/g, ' ').trim();
}

export async function renderArticleContentToVectorPdf(
  content: string,
  title?: string,
  meta?: { createdAt?: string; sessionId?: string | null },
): Promise<Blob> {
  const article = compileArticle({ content, title });
  return renderArticleToVectorPdf(article, meta);
}

export async function renderArticleToVectorPdf(
  article: CompiledArticle,
  meta?: { createdAt?: string; sessionId?: string | null },
): Promise<Blob> {
  const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4', compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - PAGE_MARGIN * 2;
  const contentBottom = pageH - PAGE_MARGIN - FOOTER_GAP;
  let y = PAGE_MARGIN;

  const paintPage = () => {
    const [r, g, b] = hexRgb(PRINT_COLORS.bg);
    doc.setFillColor(r, g, b);
    doc.rect(0, 0, pageW, pageH, 'F');
  };

  const newPage = () => {
    doc.addPage();
    paintPage();
    y = PAGE_MARGIN;
  };

  const ensure = (needed: number) => {
    if (y + needed > contentBottom) newPage();
  };

  paintPage();

  const setBody = (color: string = PRINT_COLORS.textSecondary, size = BODY_SIZE, bold = false) => {
    const [r, g, b] = hexRgb(color);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(r, g, b);
  };

  const drawSegments = (raw: string, x: number, maxWidth: number, size: number, defaultColor: string) => {
    const cleaned = raw
      .replace(/<[^>]+>/g, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1');
    const segments = splitColoredMarkup(cleaned);
    const words: Array<{ text: string; color: string }> = [];
    for (const seg of segments) {
      const color = seg.kind === 'color' ? seg.color : defaultColor;
      const parts = seg.text.split(/(\s+)/);
      for (const part of parts) {
        if (part) words.push({ text: part, color });
      }
    }

    const lines: Array<Array<{ text: string; color: string }>> = [[]];
    let lineW = 0;
    for (const word of words) {
      doc.setFontSize(size);
      const w = doc.getTextWidth(word.text);
      const current = lines[lines.length - 1]!;
      if (lineW + w > maxWidth && current.length > 0 && !/^\s+$/.test(word.text)) {
        lines.push([{ text: word.text, color: word.color }]);
        lineW = w;
      } else {
        current.push(word);
        lineW += w;
      }
    }

    const lineH = size * 1.4;
    for (const line of lines) {
      ensure(lineH);
      let cx = x;
      for (const piece of line) {
        setBody(piece.color, size, piece.color !== defaultColor);
        doc.text(piece.text, cx, y + size);
        cx += doc.getTextWidth(piece.text);
      }
      y += lineH;
    }
  };

  const drawHeading = (text: string, depth: number) => {
    const sizes = [16, 13, 12, 11, 10, 10];
    const size = sizes[Math.max(0, Math.min(depth - 1, 5))] ?? 12;
    ensure(size + 16);
    y += depth === 1 ? 0 : 8;
    setBody(PRINT_COLORS.textPrimary, size, true);
    const wrapped = doc.splitTextToSize(text, contentW) as string[];
    for (const line of wrapped) {
      ensure(size * 1.35);
      doc.text(line, PAGE_MARGIN, y + size);
      y += size * 1.35;
    }
    if (depth === 2) {
      const [r, g, b] = hexRgb(PRINT_COLORS.borderSubtle);
      doc.setDrawColor(r, g, b);
      doc.setLineWidth(0.6);
      doc.line(PAGE_MARGIN, y + 2, PAGE_MARGIN + contentW, y + 2);
      y += 8;
    } else {
      y += 4;
    }
  };

  const drawKicker = (text: string) => {
    ensure(16);
    setBody(PRINT_COLORS.accentCyan, 8, true);
    doc.text(text.toUpperCase(), PAGE_MARGIN, y + 8);
    y += 14;
  };

  const drawParagraph = (text: string) => {
    if (!text.trim()) return;
    drawSegments(text, PAGE_MARGIN, contentW, BODY_SIZE, PRINT_COLORS.textSecondary);
    y += 4;
  };

  const drawList = (items: Array<{ text: string; checked?: boolean }>, ordered: boolean) => {
    let n = 1;
    for (const item of items) {
      const bullet = item.checked != null ? (item.checked ? '☑' : '☐') : (ordered ? `${n}.` : '•');
      n += 1;
      ensure(LINE);
      setBody(PRINT_COLORS.accentCyan, BODY_SIZE, true);
      doc.text(bullet, PAGE_MARGIN, y + BODY_SIZE);
      const bulletW = doc.getTextWidth(`${bullet}  `);
      drawSegments(item.text, PAGE_MARGIN + bulletW, contentW - bulletW, BODY_SIZE, PRINT_COLORS.textSecondary);
    }
    y += 2;
  };

  const drawCode = (text: string) => {
    const lines = text.replace(/\n$/, '').split('\n');
    ensure(TABLE_LINE + 16);
    const [br, bg, bb] = hexRgb(PRINT_COLORS.borderSubtle);
    y += 4;
    const boxTop = y;
    y += 8;
    setBody(PRINT_COLORS.textSecondary, TABLE_SIZE, false);
    doc.setFont('courier', 'normal');
    for (const line of lines) {
      ensure(TABLE_LINE);
      doc.text(line.slice(0, 120), PAGE_MARGIN + 8, y + TABLE_SIZE);
      y += TABLE_LINE;
    }
    const boxH = y - boxTop + 6;
    doc.setDrawColor(br, bg, bb);
    doc.setLineWidth(0.4);
    doc.rect(PAGE_MARGIN, boxTop, contentW, boxH, 'S');
    y += 8;
  };

  const drawQuote = (text: string) => {
    const [r, g, b] = hexRgb(PRINT_COLORS.accentBlue);
    ensure(LINE * 2);
    const startY = y;
    drawSegments(text, PAGE_MARGIN + 12, contentW - 12, BODY_SIZE, PRINT_COLORS.textSecondary);
    doc.setFillColor(r, g, b);
    doc.rect(PAGE_MARGIN, startY, 3, Math.max(y - startY, LINE), 'F');
    y += 6;
  };

  const drawHr = () => {
    ensure(12);
    const [r, g, b] = hexRgb(PRINT_COLORS.borderSubtle);
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(0.6);
    doc.line(PAGE_MARGIN, y + 4, PAGE_MARGIN + contentW, y + 4);
    y += 12;
  };

  const drawTable = (block: Extract<ArticleBlock, { type: 'table' }>) => {
    const headers = block.headers;
    const rows = block.rows;
    if (!headers.length && !rows.length) return;
    const cols = Math.max(headers.length, ...rows.map((row) => row.length), 1);
    const widths = Array.from({ length: cols }, () => contentW / cols);

    const measureRow = (cells: string[]) => {
      let h = TABLE_LINE + CELL_PAD_Y * 2;
      for (let i = 0; i < cols; i++) {
        const raw = cells[i] ?? '';
        const innerW = (widths[i] ?? 40) - CELL_PAD_X * 2;
        doc.setFontSize(TABLE_SIZE);
        const wrapped = doc.splitTextToSize(plainCell(raw) || ' ', Math.max(12, innerW)) as string[];
        h = Math.max(h, wrapped.length * TABLE_LINE + CELL_PAD_Y * 2);
      }
      return h;
    };

    const paintRow = (cells: string[], rowH: number, header: boolean) => {
      let x = PAGE_MARGIN;
      const [sr, sg, sb] = hexRgb(PRINT_COLORS.surface);
      const [br, bg, bb] = hexRgb(PRINT_COLORS.borderSubtle);
      const [tr, tg, tb] = hexRgb(PRINT_COLORS.textPrimary);
      const [dr, dg, db] = hexRgb(PRINT_COLORS.textSecondary);
      for (let i = 0; i < cols; i++) {
        const w = widths[i] ?? 40;
        if (header) {
          doc.setFillColor(sr, sg, sb);
          doc.rect(x, y, w, rowH, 'F');
        }
        doc.setDrawColor(br, bg, bb);
        doc.setLineWidth(0.4);
        doc.line(x, y + rowH, x + w, y + rowH);
        const raw = cells[i] ?? '';
        const segs = splitColoredMarkup(raw);
        const cy = y + CELL_PAD_Y + TABLE_SIZE;
        if (segs.length === 1 && segs[0]?.kind === 'text') {
          doc.setFont('helvetica', header ? 'bold' : 'normal');
          doc.setFontSize(TABLE_SIZE);
          doc.setTextColor(header ? tr : dr, header ? tg : dg, header ? tb : db);
          const wrapped = doc.splitTextToSize(plainCell(raw) || ' ', Math.max(12, w - CELL_PAD_X * 2)) as string[];
          wrapped.forEach((line, li) => {
            doc.text(line, x + CELL_PAD_X, cy + li * TABLE_LINE);
          });
        } else {
          let cx = x + CELL_PAD_X;
          for (const seg of segs) {
            const color = seg.kind === 'color' ? seg.color : (header ? PRINT_COLORS.textPrimary : PRINT_COLORS.textSecondary);
            const [cr, cg, cb] = hexRgb(color);
            doc.setFont('helvetica', seg.kind === 'color' || header ? 'bold' : 'normal');
            doc.setFontSize(TABLE_SIZE);
            doc.setTextColor(cr, cg, cb);
            doc.text(seg.text, cx, cy);
            cx += doc.getTextWidth(seg.text);
          }
        }
        x += w;
      }
      y += rowH;
    };

    const headerH = headers.length ? measureRow(headers) : 0;
    const drawHeader = () => {
      if (!headers.length) return;
      ensure(headerH + TABLE_LINE);
      paintRow(headers, headerH, true);
    };

    drawHeader();
    for (const row of rows) {
      const padded = Array.from({ length: cols }, (_, i) => row[i] ?? '');
      const rowH = measureRow(padded);
      if (y + rowH > contentBottom) {
        newPage();
        drawHeader();
      }
      paintRow(padded, rowH, false);
    }
    y += 8;
  };

  const drawBlock = (block: ArticleBlock) => {
    switch (block.type) {
      case 'heading':
        drawHeading(block.text, block.level);
        break;
      case 'paragraph':
        drawParagraph(block.text);
        break;
      case 'list':
        drawList(block.items, block.ordered);
        break;
      case 'table':
        drawTable(block);
        break;
      case 'code':
        drawCode(block.code);
        break;
      case 'quote':
        drawQuote(block.text);
        break;
      case 'hr':
        drawHr();
        break;
    }
  };

  drawKicker(article.kicker);
  drawHeading(article.title, 1);
  const metaLine = [
    meta?.createdAt ? new Date(meta.createdAt).toLocaleString() : '',
    meta?.sessionId ? `session ${meta.sessionId.slice(-8)}` : '',
  ].filter(Boolean).join('  ·  ');
  if (metaLine) {
    setBody(PRINT_COLORS.textDim, 8, false);
    ensure(12);
    doc.text(metaLine, PAGE_MARGIN, y + 8);
    y += 16;
  }

  for (const block of article.blocks) drawBlock(block);

  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    setBody(PRINT_COLORS.textDim, 8, false);
    doc.text(`${i} / ${total}`, pageW / 2, pageH - 18, { align: 'center' });
  }

  const buf = doc.output('arraybuffer');
  return new Blob([buf], { type: 'application/pdf' });
}
