/**
 * Shared heuristics for deciding whether extracted PDF/document text is usable
 * or should fall through to OCR / vision materialization.
 *
 * Scanned government PDFs often yield:
 * - raw binary stream junk (control chars), or
 * - CID / broken-ToUnicode "printable" garbage that looks like text but isn't.
 */

export type TextQualityAssessment = {
  usable: boolean;
  score: number;
  reason: string;
};

const SIGNATURE_ONLY_RE =
  /digitally signed by|signature not verified|location:\s*tamil nadu|secnvtto?pdf/i;

/** Common English function/content words — cheap signal for real prose. */
const COMMON_WORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'are', 'was', 'were',
  'have', 'has', 'not', 'but', 'all', 'can', 'will', 'shall', 'must', 'should',
  'tender', 'bid', 'notice', 'date', 'page', 'form', 'name', 'address', 'india',
  'government', 'department', 'online', 'portal', 'document', 'please', 'submit',
]);

function hasBinaryControlPrefix(text: string): boolean {
  const sample = text.slice(0, 400);
  for (const ch of sample) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f)) {
      return true;
    }
  }
  return false;
}

function printableAsciiRatio(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  let printable = 0;
  let total = 0;
  for (const ch of trimmed) {
    const code = ch.codePointAt(0) ?? 0;
    total++;
    if (code === 9 || code === 10 || code === 13) { printable++; continue; }
    if (code >= 32 && code <= 126) { printable++; continue; }
    // Latin-1 supplement letters/punct commonly appear in real docs.
    if (code >= 160 && code <= 255) { printable++; continue; }
    // Do NOT treat arbitrary BMP / CJK as "printable success" — CID maps abuse that.
  }
  return total === 0 ? 0 : printable / total;
}

function controlCharRatio(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  let controls = 0;
  let total = 0;
  for (const ch of trimmed) {
    const code = ch.codePointAt(0) ?? 0;
    total++;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) controls++;
  }
  return total === 0 ? 0 : controls / total;
}

function spaceDensity(text: string): number {
  const trimmed = text.trim();
  if (!trimmed.length) return 0;
  let spaces = 0;
  for (const ch of trimmed) if (ch === ' ' || ch === '\n' || ch === '\t') spaces++;
  return spaces / trimmed.length;
}

function latinLetterRatio(text: string): number {
  let letters = 0;
  let latin = 0;
  for (const ch of text) {
    if (/\p{L}/u.test(ch)) {
      letters++;
      if (/[A-Za-zÀ-ÿ]/.test(ch)) latin++;
    }
  }
  return letters === 0 ? 0 : latin / letters;
}

function wordSignal(text: string): { tokenCount: number; commonHits: number; wordLikeRatio: number } {
  const tokens = text.toLowerCase().match(/[a-z0-9][a-z0-9'-]{1,}/g) ?? [];
  let commonHits = 0;
  for (const t of tokens) if (COMMON_WORDS.has(t)) commonHits++;
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  const wordChars = tokens.reduce((n, t) => n + t.length, 0);
  return {
    tokenCount: tokens.length,
    commonHits,
    wordLikeRatio: letters === 0 ? 0 : wordChars / letters,
  };
}

/**
 * Assess whether extracted text is good enough to treat as document content.
 * When `pageCount` is provided, very short extracts are treated as signature/metadata.
 */
export function assessExtractedText(
  text: string,
  opts?: { pageCount?: number },
): TextQualityAssessment {
  const trimmed = (text ?? '').trim();
  if (!trimmed) {
    return { usable: false, score: 0, reason: 'empty' };
  }

  const asciiRatio = printableAsciiRatio(trimmed);
  if (asciiRatio < 0.55) {
    return { usable: false, score: Math.round(asciiRatio * 40), reason: 'binary-or-control-heavy' };
  }
  const controls = controlCharRatio(trimmed);
  if (controls >= 0.08) {
    return { usable: false, score: Math.round((1 - controls) * 40), reason: 'control-char-contaminated' };
  }

  const spaces = spaceDensity(trimmed);
  const latin = latinLetterRatio(trimmed);
  const words = wordSignal(trimmed);
  const pageCount = opts?.pageCount && opts.pageCount > 0 ? opts.pageCount : undefined;
  const avgPerPage = pageCount ? trimmed.length / pageCount : trimmed.length;

  // Signature / metadata only (common on scanned e-tenders).
  if (SIGNATURE_ONLY_RE.test(trimmed) && trimmed.length < 800 && words.commonHits < 4) {
    return { usable: false, score: 15, reason: 'signature-or-metadata-only' };
  }
  if (pageCount && avgPerPage < 80 && words.commonHits < 6) {
    return { usable: false, score: 20, reason: 'too-short-for-page-count' };
  }

  // CID / broken ToUnicode: lots of letters but few Latin letters / spaces / dictionary hits.
  if (latin < 0.45 && words.tokenCount > 0) {
    return { usable: false, score: Math.round(latin * 50), reason: 'cid-or-wrong-script-mapping' };
  }
  if (spaces < 0.04 && trimmed.length > 100) {
    return { usable: false, score: 25, reason: 'no-word-boundaries' };
  }
  if (trimmed.length > 400 && words.commonHits === 0 && words.wordLikeRatio < 0.35) {
    return { usable: false, score: 30, reason: 'no-lexical-signal' };
  }

  // Score blends ascii, latin, space, and lexicon signals.
  const score = Math.round(
    Math.min(100,
      asciiRatio * 35
      + latin * 25
      + Math.min(spaces / 0.15, 1) * 15
      + Math.min(words.commonHits / 8, 1) * 25,
    ),
  );

  if (score < 45) {
    return { usable: false, score, reason: 'low-quality-extract' };
  }
  return { usable: true, score, reason: 'ok' };
}

/** Back-compat helper used across call sites. */
export function isUsableExtractedText(text: string, opts?: { pageCount?: number }): boolean {
  return assessExtractedText(text, opts).usable;
}

/**
 * Detect tool outputs that look like failed PDF extraction so the turn
 * governor can treat them as non-progress even when success=true.
 */
export function looksLikeFailedPdfExtract(output: string): boolean {
  const o = (output ?? '').trim();
  if (!o) return true;
  if (o.includes('ÿÿÿ') || hasBinaryControlPrefix(o)) {
    return true;
  }
  if (/OCR pipeline did not produce|no extractable text|scanned\/image-based/i.test(o)
    && o.length < 400) {
    return true;
  }
  return !assessExtractedText(o).usable && o.length > 80;
}
