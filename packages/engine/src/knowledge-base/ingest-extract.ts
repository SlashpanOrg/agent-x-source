import type { AttachmentPreview } from '@agentx/shared';
import { extractFromPath, type ExtractProgress } from '../attachments/extract.js';
import { isUsableExtractedText } from '../documents/text-quality.js';

const OCR_PLACEHOLDER_RE = /^\((?:no text detected by OCR|OCR failed)\)$/i;

export function isScannedPdfExtractError(message: string | undefined): boolean {
  if (!message) return false;
  return /scanned pdf/i.test(message) || /no extractable text/i.test(message);
}

/** Split `--- Page N ---` OCR output into a dense page list (1-indexed holes become ''). */
export function parseOcrPageText(ocrText: string): string[] {
  const trimmed = (ocrText ?? '').trim();
  if (!trimmed) return [];
  if (!/^--- Page \d+ ---/m.test(trimmed)) return [trimmed];

  const pages: string[] = [];
  const re = /--- Page (\d+) ---\n?([\s\S]*?)(?=\n--- Page \d+ ---|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(trimmed)) !== null) {
    const index = Math.max(1, parseInt(match[1] ?? '1', 10)) - 1;
    pages[index] = (match[2] ?? '').trim();
  }
  for (let i = 0; i < pages.length; i++) {
    if (pages[i] == null) pages[i] = '';
  }
  return pages;
}

function textForQuality(pages: string[]): string {
  return pages
    .map((page) => page.replace(OCR_PLACEHOLDER_RE, '').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

/**
 * Native extract first. When a PDF is image/outlined (the scanned-PDF error
 * that chat uses to fall through to OCR), run the same shell OCR pipeline
 * so knowledge-base ingest does not fail at EXTRACT.
 */
export async function extractKnowledgeSource(
  path: string,
  mimeType: string,
  onProgress?: ExtractProgress,
): Promise<AttachmentPreview> {
  const preview = await extractFromPath(path, mimeType, onProgress);
  if (preview.kind !== 'error') return preview;
  if (mimeType !== 'application/pdf') return preview;
  if (!isScannedPdfExtractError(preview.content)) return preview;

  await onProgress?.('OCR scanned PDF', 0.4);
  const ocrPreview = await ocrScannedPdfForIngest(path, preview.content ?? 'Scanned PDF');
  await onProgress?.('OCR complete', 0.95);
  return ocrPreview;
}

async function ocrScannedPdfForIngest(
  path: string,
  nativeError: string,
): Promise<AttachmentPreview> {
  const { ocrPdfViaShell, cleanupPdfOcrTemp } = await import('../templates/pdf-ocr.js');
  const result = await ocrPdfViaShell(path, { maxPages: 80, dpi: 200 });
  try {
    const missingTools = result.warnings.filter((w) => /not found/i.test(w));
    if (missingTools.length > 0) {
      return {
        kind: 'error',
        content: `${nativeError} — OCR tools missing (${missingTools.join('; ')})`,
      };
    }
    if (result.imagePaths.length === 0) {
      const why = result.warnings.join('; ') || 'pdftoppm produced no pages';
      return { kind: 'error', content: `${nativeError} — OCR render failed (${why})` };
    }

    const pages = parseOcrPageText(result.text);
    const cleaned = textForQuality(pages);
    if (!cleaned) {
      return { kind: 'error', content: `${nativeError} — OCR produced no text` };
    }
    if (!isUsableExtractedText(cleaned, { pageCount: Math.max(pages.length, result.numPages || 0) || undefined })) {
      return { kind: 'error', content: `${nativeError} — OCR text failed quality checks` };
    }
    return {
      kind: 'text',
      content: pages.join('\n\n'),
      pages: pages.length > 0 ? pages : [cleaned],
    };
  } finally {
    cleanupPdfOcrTemp(result);
  }
}
