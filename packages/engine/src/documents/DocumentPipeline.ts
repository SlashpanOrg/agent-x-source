/**
 * Pre-turn document materialization — turn user attachments into a typed
 * DocumentObject (text + confidence + optional page images) before the LLM loop.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getLogger } from '@agentx/shared';
import type { NormalizedAttachment } from '@agentx/shared';
import { assessExtractedText, isUsableExtractedText } from './text-quality.js';

export type DocumentMethod = 'native' | 'ocr-shell' | 'ocr-pdfjs' | 'path-only' | 'none';

export type DocumentObject = {
  name: string;
  path: string | null;
  mimeType: string;
  text: string | null;
  method: DocumentMethod;
  confidence: 'high' | 'medium' | 'low' | 'none';
  pageCount?: number;
  warnings: string[];
  /** Ready-to-inject prompt block for the model. */
  promptBlock: string;
  /** Inline page images for vision models (caller owns lifecycle of any temp files). */
  visionAttachments: NormalizedAttachment[];
  /** Temp dirs the caller should clean up after the turn (best-effort). */
  cleanupDirs: string[];
};

export type MaterializeOptions = {
  name: string;
  mimeType?: string;
  absPath: string | null;
  /** Pre-extracted text from attachment preview / cache (may be garbage). */
  candidateText?: string | null;
  storageId?: string;
  attachmentId?: string;
  /** Fetch raw bytes when path-based OCR fallbacks need them. */
  getBuffer?: () => Promise<Buffer | null>;
  visionOk?: boolean;
  maxPages?: number;
  dpi?: number;
};

function isPdf(name: string, mimeType?: string): boolean {
  return mimeType === 'application/pdf' || /\.pdf$/i.test(name);
}

function noSearchNotice(pathHint: string): string {
  return `This file was explicitly attached by the user — it already exists at "${pathHint}", and reading/parsing it requires no extra permission. `
    + `The platform has already materialized its content below. Do NOT run file_find, glob, folder_tree, tool_search, or shell searches to locate or re-extract it. `
    + `Do NOT ask the user for permission to OCR/read this attachment. Analyse the content and deliver the user's requested output.`;
}

/**
 * Materialize a single attachment into model-ready document context.
 * Prefer native text when quality is high; otherwise run OCR automatically.
 */
export async function materializeAttachment(opts: MaterializeOptions): Promise<DocumentObject> {
  const warnings: string[] = [];
  const cleanupDirs: string[] = [];
  const visionAttachments: NormalizedAttachment[] = [];
  const pathHint = opts.absPath ?? opts.name;
  const maxPages = opts.maxPages ?? 20;
  const dpi = opts.dpi ?? 200;

  if (!isPdf(opts.name, opts.mimeType)) {
    const text = opts.candidateText?.trim() ? opts.candidateText : null;
    if (text && isUsableExtractedText(text)) {
      return {
        name: opts.name,
        path: opts.absPath,
        mimeType: opts.mimeType ?? 'application/octet-stream',
        text,
        method: 'native',
        confidence: 'high',
        warnings,
        promptBlock:
          `[Attachment: ${opts.name}]\n${text}`
          + (opts.absPath
            ? `\n[File path: ${opts.absPath} — use file_read/image_ocr on this path only if you need to re-read it.]`
            : ''),
        visionAttachments,
        cleanupDirs,
      };
    }
    return {
      name: opts.name,
      path: opts.absPath,
      mimeType: opts.mimeType ?? 'application/octet-stream',
      text: null,
      method: opts.absPath ? 'path-only' : 'none',
      confidence: 'none',
      warnings,
      promptBlock: opts.absPath
        ? `[Attachment: ${opts.name}]\n[File path: ${opts.absPath} — this file was explicitly attached by the user. `
          + `Reading/parsing it requires no extra permission. Use file_read/image_ocr directly on this path. `
          + `Do NOT run file_find, glob, folder_tree, or shell searches to locate it.]`
        : `[Attachment: ${opts.name}]\n[No extractable content.]`,
      visionAttachments,
      cleanupDirs,
    };
  }

  // ── PDF path ────────────────────────────────────────────────────────────
  const candidate = opts.candidateText?.trim() ?? '';
  if (candidate) {
    const quality = assessExtractedText(candidate);
    if (quality.usable) {
      return {
        name: opts.name,
        path: opts.absPath,
        mimeType: 'application/pdf',
        text: candidate,
        method: 'native',
        confidence: quality.score >= 70 ? 'high' : 'medium',
        warnings,
        promptBlock:
          `[Attachment: ${opts.name}]\n${candidate}\n`
          + `[File path: ${pathHint} — content already extracted (${quality.score}/100 quality). `
          + `Analyse proactively. Do not re-run pdf_read/OCR unless the user asks.]`,
        visionAttachments,
        cleanupDirs,
      };
    }
    warnings.push(`native-extract-rejected:${quality.reason}`);
  }

  // Shell OCR (pdftoppm → tesseract)
  if (opts.absPath && existsSync(opts.absPath)) {
    try {
      const { ocrPdfViaShell, cleanupPdfOcrTemp } = await import('../templates/pdf-ocr.js');
      const ocrResult = await ocrPdfViaShell(opts.absPath, { maxPages, dpi });
      const ocrText = ocrResult.text.trim();
      if (ocrText && isUsableExtractedText(ocrText, { pageCount: ocrResult.numPages || undefined })) {
        const pageSummary = `${ocrResult.numPages} page(s), ${ocrResult.imagePaths.length} rendered, ${ocrText.length} chars extracted`;
        if (opts.visionOk && ocrResult.imagePaths.length > 0) {
          const maxVisionPages = Math.min(ocrResult.imagePaths.length, 6);
          for (let i = 0; i < maxVisionPages; i++) {
            try {
              const imgBuf = readFileSync(ocrResult.imagePaths[i]!);
              visionAttachments.push({
                id: `${opts.attachmentId ?? opts.name}-page-${i + 1}`,
                type: 'image',
                name: `${opts.name} (page ${i + 1})`,
                mimeType: 'image/png',
                content: `data:image/png;base64,${imgBuf.toString('base64')}`,
                isInline: true,
              });
            } catch { /* ignore */ }
          }
          if (ocrResult.tempDir) cleanupDirs.push(ocrResult.tempDir);
          else cleanupPdfOcrTemp(ocrResult);
          return {
            name: opts.name,
            path: opts.absPath,
            mimeType: 'application/pdf',
            text: ocrText,
            method: 'ocr-shell',
            confidence: 'high',
            pageCount: ocrResult.numPages,
            warnings,
            promptBlock:
              `[Attachment: ${opts.name}]\n`
              + `[This is a scanned/image-based PDF at "${pathHint}". ${noSearchNotice(pathHint)} `
              + `OCR has already extracted the text below (${pageSummary}). ${Math.min(ocrResult.imagePaths.length, 6)} page image(s) are also attached for visual reference. `
              + `Use the OCR text as the primary source and deliver a complete response.]\n\n`
              + `[OCR EXTRACTED TEXT]\n${ocrText}`,
            visionAttachments,
            cleanupDirs,
          };
        }
        cleanupPdfOcrTemp(ocrResult);
        return {
          name: opts.name,
          path: opts.absPath,
          mimeType: 'application/pdf',
          text: ocrText,
          method: 'ocr-shell',
          confidence: 'high',
          pageCount: ocrResult.numPages,
          warnings,
          promptBlock:
            `[Attachment: ${opts.name}]\n`
            + `[This is a scanned/image-based PDF at "${pathHint}". ${noSearchNotice(pathHint)} `
            + `OCR (tesseract) has already extracted the text below (${pageSummary}). `
            + `Analyse this content proactively and provide a complete response — do NOT ask the user to re-upload, paste content, or grant OCR permission.]\n\n`
            + `[OCR EXTRACTED TEXT]\n${ocrText}`,
          visionAttachments,
          cleanupDirs,
        };
      }
      cleanupPdfOcrTemp(ocrResult);
      if (!ocrText) warnings.push('shell-ocr-empty');
      else warnings.push('shell-ocr-low-quality');
    } catch (err) {
      warnings.push(`shell-ocr-failed:${err instanceof Error ? err.message : String(err)}`);
      getLogger().warn('DOCUMENT_PIPELINE', `Shell OCR failed for ${opts.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // pdfjs + canvas fallback
  try {
    const buf = opts.getBuffer ? await opts.getBuffer() : (opts.absPath && existsSync(opts.absPath) ? readFileSync(opts.absPath) : null);
    if (buf) {
      const { renderPdfPagesToPng } = await import('../templates/pdf-render.js');
      const rendered = await renderPdfPagesToPng(buf, { maxPages, dpi, maxEdgePx: 2000 });
      if (rendered.pages.length > 0) {
        const tempDir = join(tmpdir(), `pdf-pipeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        mkdirSync(tempDir, { recursive: true });
        cleanupDirs.push(tempDir);
        const savedPaths: string[] = [];
        for (const pg of rendered.pages) {
          const imgPath = join(tempDir, `${opts.name.replace(/\.pdf$/i, '')}-page-${pg.page}.png`);
          try {
            writeFileSync(imgPath, pg.png);
            savedPaths.push(imgPath);
          } catch { /* ignore */ }
        }

        let ocrText = '';
        try {
          const { execSync } = await import('node:child_process');
          const pages: string[] = [];
          for (const imgPath of savedPaths) {
            try {
              const t = execSync(`tesseract "${imgPath}" stdout 2>/dev/null`, {
                encoding: 'utf-8',
                timeout: 30_000,
                maxBuffer: 10 * 1024 * 1024,
              }).trim();
              pages.push(t || '');
            } catch {
              pages.push('');
            }
          }
          ocrText = pages.filter(Boolean).join('\n\n');
        } catch { /* no tesseract */ }

        if (opts.visionOk) {
          for (const pg of rendered.pages) {
            visionAttachments.push({
              id: `${opts.attachmentId ?? opts.name}-page-${pg.page}`,
              type: 'image',
              name: `${opts.name} (page ${pg.page})`,
              mimeType: 'image/png',
              content: `data:image/png;base64,${pg.png.toString('base64')}`,
              isInline: true,
            });
          }
          const ocrSection = ocrText && isUsableExtractedText(ocrText)
            ? `\n\n[OCR EXTRACTED TEXT]\n${ocrText}`
            : '';
          return {
            name: opts.name,
            path: opts.absPath,
            mimeType: 'application/pdf',
            text: ocrText || null,
            method: 'ocr-pdfjs',
            confidence: ocrText ? 'medium' : 'low',
            pageCount: rendered.pages.length,
            warnings,
            promptBlock:
              `[Attachment: ${opts.name}]\n`
              + `[This is a scanned/image-based PDF at "${pathHint}". ${noSearchNotice(pathHint)} `
              + `${rendered.pages.length} page image(s) are attached below — read them directly to analyse the document.${ocrSection}]`,
            visionAttachments,
            cleanupDirs,
          };
        }

        if (ocrText && isUsableExtractedText(ocrText)) {
          return {
            name: opts.name,
            path: opts.absPath,
            mimeType: 'application/pdf',
            text: ocrText,
            method: 'ocr-pdfjs',
            confidence: 'medium',
            pageCount: rendered.pages.length,
            warnings,
            promptBlock:
              `[Attachment: ${opts.name}]\n`
              + `[OCR-extracted text from scanned PDF at "${pathHint}". ${noSearchNotice(pathHint)} `
              + `Analyse this content proactively and provide a complete response.]\n\n`
              + `[OCR EXTRACTED TEXT]\n${ocrText}`,
            visionAttachments,
            cleanupDirs,
          };
        }
      }
    }
  } catch (err) {
    warnings.push(`pdfjs-fallback-failed:${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    name: opts.name,
    path: opts.absPath,
    mimeType: 'application/pdf',
    text: null,
    method: 'none',
    confidence: 'none',
    warnings,
    promptBlock:
      `[Attachment: ${opts.name}]\n`
      + `[The PDF at "${pathHint}" is available but its content could not be extracted or rendered. ${noSearchNotice(pathHint)} `
      + `Ask the user for the key details directly if you cannot proceed. Do not thrash with tool_search/file_find/shell.]`,
    visionAttachments,
    cleanupDirs,
  };
}

export function cleanupDocumentTemps(docs: DocumentObject[]): void {
  for (const doc of docs) {
    for (const dir of doc.cleanupDirs) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
}
