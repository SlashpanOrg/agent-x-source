/**
 * Shell-based PDF OCR pipeline:
 *   pdftoppm (poppler) → PNG pages → tesseract → text
 *
 * This is more reliable than the pdfjs-dist + @napi-rs/canvas approach in
 * Electron packaged environments where native canvas bindings may fail to load.
 * It also processes ALL pages (not just a capped subset) and returns both the
 * extracted text AND the rendered image paths so vision models can be given
 * both the image and the OCR text for maximum accuracy.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getLogger } from '@agentx/shared';
import {
  checkCommandExists,
  execPlatformSafe,
  getPdfinfoCheckCommand,
} from '../tools/platform.js';
import { prependOcrToolPath } from '../knowledge-base/ocr-tools.js';

export interface PdfOcrResult {
  /** OCR-extracted text from all pages, joined by page markers. */
  text: string;
  /** Paths to rendered PNG files (in a temp directory). Caller should clean up. */
  imagePaths: string[];
  /** Number of pages in the PDF. */
  numPages: number;
  /** Whether the shell pipeline (pdftoppm + tesseract) was used vs pdfjs fallback. */
  method: 'shell' | 'pdfjs-fallback';
  /** Temp directory containing rendered images. Caller should rmSync it when done. */
  tempDir: string | null;
  /** Non-fatal warnings. */
  warnings: string[];
}

/**
 * Get the number of pages in a PDF using `pdfinfo` (poppler).
 * Returns null if pdfinfo is unavailable or the PDF is unreadable.
 */
export function getPdfPageCount(pdfPath: string): number | null {
  try {
    execSync(getPdfinfoCheckCommand(), { encoding: 'utf-8', stdio: 'pipe' });
  } catch {
    return null;
  }
  try {
    const output = execPlatformSafe(`pdfinfo "${pdfPath}" 2>/dev/null`, { timeout: 10_000 });
    if (!output) return null;
    const match = output.match(/^Pages:\s+(\d+)/m);
    return match ? parseInt(match[1]!, 10) : null;
  } catch {
    return null;
  }
}

/**
 * Full shell-based OCR pipeline: pdftoppm → PNG → tesseract → text.
 *
 * @param pdfPath Absolute path to the PDF file.
 * @param opts Rendering and OCR options.
 * @returns PdfOcrResult with extracted text and rendered image paths.
 */
export async function ocrPdfViaShell(
  pdfPath: string,
  opts: { dpi?: number; maxPages?: number } = {},
): Promise<PdfOcrResult> {
  const dpi = opts.dpi ?? 200;
  const maxPages = opts.maxPages ?? 20;
  const warnings: string[] = [];

  prependOcrToolPath();

  // Check that both pdftoppm and tesseract are available.
  const hasPdftoppm = checkCommandExists('pdftoppm');
  const hasTesseract = checkCommandExists('tesseract');

  if (!hasPdftoppm || !hasTesseract) {
    return {
      text: '',
      imagePaths: [],
      numPages: 0,
      method: 'shell',
      tempDir: null,
      warnings: [
        ...(!hasPdftoppm ? ['pdftoppm (poppler) not found'] : []),
        ...(!hasTesseract ? ['tesseract not found'] : []),
      ],
    };
  }

  // Get page count.
  let numPages = getPdfPageCount(pdfPath) ?? 0;
  if (numPages === 0) {
    // Fallback: try pdfjs for page count only.
    try {
      const { renderPdfPagesToPng } = await import('./pdf-render.js');
      const buf = readFileSync(pdfPath);
      const probe = await renderPdfPagesToPng(buf, { maxPages: 1, dpi: 72 });
      numPages = probe.numPages;
    } catch {
      warnings.push('Could not determine page count');
    }
  }

  const pagesToRender = Math.min(numPages || maxPages, maxPages);

  // Create a temp directory for rendered images.
  const tempDir = join(tmpdir(), `pdf-ocr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(tempDir, { recursive: true });

  const baseName = 'page';
  const imagePaths: string[] = [];
  const textParts: string[] = [];

  try {
    // Render pages using pdftoppm: pdftoppm -png -r <dpi> -l <pages> input.pdf prefix
    // -png: output PNG format
    // -r: resolution in DPI
    // -l: last page to render (renders 1..l)
    const renderCmd = `pdftoppm -png -r ${dpi} -l ${pagesToRender} "${pdfPath}" "${join(tempDir, baseName)}" 2>/dev/null`;
    execPlatformSafe(renderCmd, { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 });

    // pdftoppm names files as prefix-1.png, prefix-2.png, ... (zero-padded to page count)
    // Find all rendered PNGs and sort by page number.
    const files = readdirSync(tempDir)
      .filter((f) => f.endsWith('.png') && f.startsWith(baseName))
      .sort((a, b) => {
        const na = parseInt(a.match(/(\d+)\.png$/)?.[1] ?? '0', 10);
        const nb = parseInt(b.match(/(\d+)\.png$/)?.[1] ?? '0', 10);
        return na - nb;
      });

    for (const file of files) {
      const imgPath = join(tempDir, file);
      imagePaths.push(imgPath);

      // OCR each page with tesseract.
      try {
        const ocrText = execPlatformSafe(`tesseract "${imgPath}" stdout 2>/dev/null`, {
          timeout: 60_000,
          maxBuffer: 10 * 1024 * 1024,
        });
        const trimmed = (ocrText || '').trim();
        const pageNum = parseInt(file.match(/(\d+)\.png$/)?.[1] ?? '0', 10);
        if (trimmed) {
          textParts.push(`--- Page ${pageNum} ---\n${trimmed}`);
        } else {
          textParts.push(`--- Page ${pageNum} ---\n(no text detected by OCR)`);
        }
      } catch (err) {
        const pageNum = parseInt(file.match(/(\d+)\.png$/)?.[1] ?? '0', 10);
        warnings.push(`OCR failed on page ${pageNum}: ${err instanceof Error ? err.message : String(err)}`);
        textParts.push(`--- Page ${pageNum} ---\n(OCR failed)`);
      }
    }

    if (imagePaths.length === 0) {
      warnings.push('pdftoppm produced no output files');
    }
  } catch (err) {
    warnings.push(`pdftoppm render failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  getLogger().info('PDF_OCR', `Shell OCR: ${imagePaths.length} pages, ${textParts.length} text parts, ${warnings.length} warnings`);

  return {
    text: textParts.join('\n\n'),
    imagePaths,
    numPages: numPages || imagePaths.length,
    method: 'shell',
    tempDir,
    warnings,
  };
}

/**
 * Clean up the temp directory created by ocrPdfViaShell.
 */
export function cleanupPdfOcrTemp(result: PdfOcrResult): void {
  if (result.tempDir && existsSync(result.tempDir)) {
    try {
      rmSync(result.tempDir, { recursive: true, force: true });
    } catch { /* best-effort */ }
  }
}
