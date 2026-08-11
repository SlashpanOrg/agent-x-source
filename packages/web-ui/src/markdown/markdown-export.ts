import type { UIMessage } from '../chat/types';
import {
  deriveMarkdownTitle,
  parseResponseDocument,
  responseDocumentToMarkdown,
  sanitizeMarkdownDeliverable,
} from '@agentx/shared/browser';
import { displayContent } from '../chat/utils';
import { buildPrintHtml } from './print-template';

/** Serialize a chat message into markdown for document storage (preserves chart parts). */
export function messageToMarkdownDocument(message: UIMessage): string {
  const chunks: string[] = [];
  const richPart = message.parts?.find((part) => (
    part.type === 'response_document'
    && parseResponseDocument(part.responseDocument).ok
  ));
  if (richPart?.type === 'response_document') {
    const parsed = parseResponseDocument(richPart.responseDocument);
    if (parsed.ok) {
      const richMarkdown = richPart.fallbackMarkdown?.trim()
        || responseDocumentToMarkdown(parsed.document);
      return sanitizeMarkdownDeliverable(richMarkdown);
    }
  }
  if (message.parts?.length) {
    for (const part of message.parts) {
      if (part.type === 'text' && part.content?.trim()) {
        chunks.push(part.content.trim());
      } else if (part.type === 'chart' && part.chartJson?.trim()) {
        chunks.push(`\`\`\`chart\n${part.chartJson.trim()}\n\`\`\``);
      }
    }
  }
  const fromParts = chunks.join('\n\n').trim();
  const raw = fromParts || displayContent(message);
  return sanitizeMarkdownDeliverable(raw);
}

/** Derive a markdown document title from a chat message body. */
export function deriveMarkdownTitleFromMessage(message: UIMessage): string {
  const markdown = messageToMarkdownDocument(message);
  return deriveMarkdownTitle({ contentMarkdown: markdown });
}

export interface MarkdownPdfSaveOptions {
  defaultFilename: string;
}

const PDF_COLOR_PROPS = [
  'color',
  'background-color',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'text-decoration-color',
] as const;

const PDF_SHADOW_PROPS = ['box-shadow', 'text-shadow'] as const;
const PDF_BACKGROUND_PROPS = ['background', 'background-image'] as const;

const MODERN_COLOR_RE = /(?:oklch|oklab|lab|lch|color-mix|color)\s*\((?:[^()]*|\([^)]*\))*\)/i;
const MODERN_COLOR_RE_GLOBAL = new RegExp(MODERN_COLOR_RE.source, 'gi');

/** Build a normalizer that converts any CSS color to an html2canvas-safe rgb/rgba string. */
function createColorNormalizer(doc: Document): (_value: string, _fallbackColor?: string) => string | null {
  const canvas = doc.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const cache = new Map<string, string | null>();
  if (!ctx) return (_value: string, _fallbackColor?: string) => null;

  return (value: string, fallbackColor?: string): string | null => {
    const key = value + (fallbackColor ? `|${fallbackColor}` : '');
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const trimmed = value.trim().toLowerCase();
    if (!trimmed || trimmed === 'none') {
      cache.set(key, null);
      return null;
    }
    if (trimmed === 'transparent') {
      const out = 'rgba(0, 0, 0, 0)';
      cache.set(key, out);
      return out;
    }
    if (trimmed === 'currentcolor' || trimmed === 'invert') {
      const out = fallbackColor || 'rgb(0, 0, 0)';
      cache.set(key, out);
      return out;
    }

    // html2canvas already handles legacy rgb/rgba/hex/hsl/hsla and named colors.
    if (
      /^rgba?\s*\(/.test(trimmed) ||
      /^#[0-9a-f]{3,8}$/.test(trimmed) ||
      /^hsla?\s*\(/.test(trimmed) ||
      /^[a-z]+$/.test(trimmed)
    ) {
      cache.set(key, value);
      return value;
    }

    // Use the canvas' CSS color parser to convert modern color functions.
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = value;
    const parsed = ctx.fillStyle;
    if (parsed && !MODERN_COLOR_RE.test(parsed)) {
      cache.set(key, parsed);
      return parsed;
    }

    // The canvas serialized the color as another modern function (e.g. color(srgb ...)).
    // Sample the rendered pixel to get a safe sRGB representation.
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    const out = a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a / 255})`;
    cache.set(key, out);
    return out;
  };
}

/** Replace any color()/color-mix()/oklch() value in a CSS value string with html2canvas-safe rgb/rgba. */
function normalizeColorValues(
  value: string,
  fallbackColor: string,
  normalizeColor: (_value: string, _fallbackColor?: string) => string | null,
): string | null {
  if (!value || value === 'none') return null;
  let normalized = value.replace(MODERN_COLOR_RE_GLOBAL, (match) => normalizeColor(match) || 'rgb(0, 0, 0)');
  if (fallbackColor) {
    normalized = normalized.replace(/\bcurrentcolor\b/gi, fallbackColor);
  }
  return normalized;
}

/** Inline computed rgb/rgba colors so html2canvas never parses color()/color-mix()/oklch() from stylesheets. */
function inlineComputedColorsForPdf(cloneRoot: HTMLElement): void {
  const win = cloneRoot.ownerDocument.defaultView;
  if (!win) return;

  const normalizeColor = createColorNormalizer(cloneRoot.ownerDocument);
  const elements = [cloneRoot, ...cloneRoot.querySelectorAll('*')] as HTMLElement[];

  for (const clone of elements) {
    if (!(clone instanceof HTMLElement)) continue;
    const computed = win.getComputedStyle(clone);
    const color = normalizeColor(computed.getPropertyValue('color'));
    if (color) clone.style.setProperty('color', color);
    const fallbackColor = color || 'rgb(0, 0, 0)';

    for (let i = 1; i < PDF_COLOR_PROPS.length; i++) {
      const prop = PDF_COLOR_PROPS[i]!;
      const value = computed.getPropertyValue(prop);
      const normalized = normalizeColor(value, fallbackColor);
      if (normalized) clone.style.setProperty(prop, normalized);
    }

    for (const prop of PDF_SHADOW_PROPS) {
      const value = computed.getPropertyValue(prop);
      if (value && value !== 'none') {
        const normalized = normalizeColorValues(value, fallbackColor, normalizeColor);
        if (normalized) clone.style.setProperty(prop, normalized);
      }
    }

    for (const prop of PDF_BACKGROUND_PROPS) {
      const value = computed.getPropertyValue(prop);
      if (value && value !== 'none') {
        const normalized = normalizeColorValues(value, fallbackColor, normalizeColor);
        if (normalized && normalized !== value) {
          clone.style.setProperty(prop, normalized);
        }
      }
    }
  }
}

// ─── Print-engine path (vector PDF) ─────────────────────────────────────────

/**
 * Export markdown to a **vector PDF** using Chromium's native print engine
 * via Electron's `webContents.printToPDF()`.
 *
 * This produces:
 * - Selectable, searchable text (not rasterized pixels)
 * - Crisp shapes at any zoom level
 * - CSS-controlled page breaks (`break-inside: avoid` on cards/tables)
 * - Images embedded at original quality
 * - Dramatically smaller file sizes
 *
 * Falls back to `exportElementToPdfBlob` (html2canvas rasterization) if the
 * desktop print bridge is unavailable (e.g. running in a browser).
 *
 * @param markdown  The raw markdown string to export.
 * @param title     Optional document title (used in the HTML <title>).
 * @param fallbackRoot  Optional DOM element for html2canvas fallback.
 */
export async function exportMarkdownToPdfBlob(
  markdown: string,
  title?: string,
  fallbackRoot?: HTMLElement | null,
): Promise<Blob> {
  // ─── Primary path: Electron print engine (vector PDF) ───
  if (window.agentx?.printToPdf) {
    try {
      const html = buildPrintHtml(markdown, title);
      const result = await window.agentx.printToPdf(html);
      if (result.ok && result.data) {
        return new Blob([result.data.buffer as ArrayBuffer], { type: 'application/pdf' });
      }
      // If the print engine failed, fall through to html2canvas
      console.warn('[pdf-export] print engine failed, falling back to html2canvas:', result.error);
    } catch (err) {
      console.warn('[pdf-export] print engine error, falling back to html2canvas:', err);
    }
  }

  // ─── Fallback path: html2canvas rasterization ───
  if (!fallbackRoot) {
    throw new Error('PDF export requires either the desktop print engine or a DOM element for html2canvas fallback');
  }
  return exportElementToPdfBlob(fallbackRoot);
}

/**
 * Collect natural page-break candidate y-coordinates (in CSS pixels, relative to
 * the export root's top) from block-level element boundaries.  Each candidate
 * marks the bottom edge of a top-level block so page breaks snap to box edges
 * instead of slicing through the middle of a card/table/paragraph.
 *
 * Only direct children (and a few well-known wrapper descendants like table
 * rows) are considered — this keeps the candidate set small and avoids breaking
 * inside inline elements.
 */
function collectBreakPoints(root: HTMLElement): number[] {
  const rootTop = root.getBoundingClientRect().top + window.scrollY;
  const candidates: number[] = [];

  // Direct block-level children of the export root — these are the "cards",
  // headings, paragraphs, tables, lists, etc. that should not be split.
  const blockSelector = [
    ':scope > *',
    ':scope > * > *',          // one level of wrapper (e.g. styled divs)
    'table tr',                // table rows are natural break points
    'li',                      // list items
  ].join(', ');

  const elements = root.querySelectorAll(blockSelector);
  for (const el of elements) {
    if (!(el instanceof HTMLElement)) continue;
    const rect = el.getBoundingClientRect();
    const bottomY = rect.bottom - rootTop + window.scrollY;
    if (bottomY > 0 && bottomY < root.scrollHeight) {
      candidates.push(bottomY);
    }
  }

  // Deduplicate, sort ascending, and also include 0 and full height as
  // sentinel boundaries.
  candidates.push(0);
  candidates.push(root.scrollHeight);
  const unique = [...new Set(candidates)].sort((a, b) => a - b);
  return unique;
}

/** Capture a DOM subtree and produce a multi-page PDF blob (WYSIWYG).
 *
 * Page breaks are snapped to block-element boundaries so content boxes (cards,
 * tables, paragraphs) are never cut in the middle.
 */
export async function exportElementToPdfBlob(root: HTMLElement): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  await new Promise((r) => setTimeout(r, 400));

  // Collect break points BEFORE canvas capture (DOM must be intact for
  // getBoundingClientRect to return correct positions).
  const breakPointsCss = collectBreakPoints(root);

  const backgroundColor = getComputedStyle(root).backgroundColor || '#ffffff';

  const canvas = await html2canvas(root, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor,
    windowWidth: root.scrollWidth,
    windowHeight: root.scrollHeight,
    onclone: (doc) => {
      const cloneRoot = doc.querySelector('[data-markdown-export-root]');
      if (cloneRoot instanceof HTMLElement) {
        inlineComputedColorsForPdf(cloneRoot);
      }
    },
  });

  const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;

  // Scale factor: CSS pixels → canvas pixels (Y axis)
  const scaleY = canvas.height / root.scrollHeight;
  // The rendered image height in PDF points
  const imgHeightPt = (canvas.height * contentWidth) / canvas.width;

  const fillPageBackground = () => {
    pdf.setFillColor(backgroundColor);
    pdf.rect(0, 0, pageWidth, pageHeight, 'F');
  };

  // ─── Smart pagination: snap page breaks to element boundaries ───
  //
  // Walk through the break-point candidates and greedily fill each page with
  // as many blocks as fit.  When the next break point would overflow the page,
  // start a new page.  This ensures page boundaries always fall on box edges.
  //
  // If there are not enough break points (e.g. one giant block), fall back to
  // hard slicing for that page so we never overflow.

  // Convert CSS break points to PDF-point Y coordinates (from top of image)
  const breakPointsPt = breakPointsCss.map((y) => (y * scaleY * contentWidth) / canvas.width);

  // Build the list of page regions: [startY, endY] in PDF points
  const pages: Array<{ start: number; end: number }> = [];
  let cursor = 0; // current Y position in the full image (PDF points)

  while (cursor < imgHeightPt - 1) {
    const pageLimit = cursor + contentHeight;
    // Find the last break point that fits within this page
    let bestBreak = -1;
    for (const bp of breakPointsPt) {
      if (bp > cursor + 1 && bp <= pageLimit) {
        bestBreak = bp;
      } else if (bp > pageLimit) {
        break;
      }
    }

    let endY: number;
    if (bestBreak > 0) {
      // Snap to the element boundary
      endY = bestBreak;
    } else {
      // No break point fits — hard slice (rare: one block taller than a page)
      endY = Math.min(pageLimit, imgHeightPt);
    }

    pages.push({ start: cursor, end: endY });
    cursor = endY;
  }

  // Ensure at least one page
  if (pages.length === 0) {
    pages.push({ start: 0, end: Math.min(contentHeight, imgHeightPt) });
  }

  // ─── Render each page by cropping the full canvas ───
  for (let i = 0; i < pages.length; i++) {
    const { start, end } = pages[i];
    const sliceHeightPt = end - start;
    // Convert PDF-point coordinates back to canvas pixels for cropping
    const srcY = Math.round((start * canvas.width) / contentWidth);
    const srcH = Math.round((sliceHeightPt * canvas.width) / contentWidth);

    // Create a cropped canvas for this page
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = canvas.width;
    pageCanvas.height = srcH;
    const pageCtx = pageCanvas.getContext('2d');
    if (!pageCtx) continue;
    // Fill with background color to avoid transparent edges
    pageCtx.fillStyle = backgroundColor;
    pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    pageCtx.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);

    const pageImgData = pageCanvas.toDataURL('image/png');

    if (i > 0) {
      pdf.addPage();
    }
    fillPageBackground();
    // Place the cropped slice at the top of the content area
    pdf.addImage(pageImgData, 'PNG', margin, margin, contentWidth, sliceHeightPt);
  }

  return pdf.output('blob');
}

export async function savePdfBlob(blob: Blob, options: MarkdownPdfSaveOptions): Promise<string | null> {
  const name = options.defaultFilename.endsWith('.pdf')
    ? options.defaultFilename
    : `${options.defaultFilename}.pdf`;

  if (window.agentx?.saveFile && window.agentx?.writeFileBytes) {
    const path = await window.agentx.saveFile({
      defaultPath: name,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!path) return null;
    const buf = await blob.arrayBuffer();
    await window.agentx.writeFileBytes(path, new Uint8Array(buf));
    return path;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
  return name;
}
