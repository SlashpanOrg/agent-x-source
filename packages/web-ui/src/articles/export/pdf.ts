import { buildPrintHtml } from './print-html';
import { renderArticleContentToVectorPdf } from './vector-pdf';
import type { ArticleMeta } from '../types';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}

function bytesFromPrintResult(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data && typeof data === 'object' && 'data' in data && Array.isArray((data as { data: unknown }).data)) {
    return Uint8Array.from((data as { data: number[] }).data);
  }
  throw new Error('print engine returned an unreadable PDF');
}

export interface ArticlePdfSaveOptions {
  defaultFilename: string;
}

/**
 * Export a compiled document page as a vector PDF.
 * Desktop: Chromium printToPDF of the article HTML.
 * Fallback: jsPDF drawing the same article AST.
 */
export async function exportArticleToPdfBlob(
  content: string,
  title?: string,
  meta?: ArticleMeta,
): Promise<Blob> {
  if (window.agentx?.printToPdf) {
    try {
      const html = buildPrintHtml(content, title, meta);
      const result = await window.agentx.printToPdf(html);
      if (result.ok && result.data) {
        return new Blob([toArrayBuffer(bytesFromPrintResult(result.data))], { type: 'application/pdf' });
      }
      console.warn('[articles] print engine failed, using vector fallback:', result.error);
    } catch (err) {
      console.warn('[articles] print engine error, using vector fallback:', err);
    }
  }
  return renderArticleContentToVectorPdf(content, title, meta);
}

export async function savePdfBlob(blob: Blob, options: ArticlePdfSaveOptions): Promise<string | null> {
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
