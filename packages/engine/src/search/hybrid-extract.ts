/**
 * Hybrid web content extraction — runs trafilatura and agent-fetch's
 * multi-strategy extractor in parallel on the same HTML, then compares
 * and validates the results to pick the most complete and accurate output.
 *
 * trafilatura: F1 0.966 on ScrapingHub benchmark, best table preservation,
 *              page-type classification, ML quality scoring.
 * agent-fetch: 7 parallel strategies (Readability, text-density, JSON-LD,
 *              Next.js, RSC, WordPress, CSS selectors), picks most complete.
 *
 * The validator compares:
 *  - Content length (longer = more complete)
 *  - Table presence (critical for structured data like tenders)
 *  - trafilatura extractionQuality score (0.0–1.0)
 *  - Text overlap ratio (detects divergence between extractors)
 *  - Structural markers (headings, lists, code blocks)
 */

import { extract as trafilaturaExtract } from 'trafilatura';
import { extractFromHtml as agentFetchExtract } from '@teng-lin/agent-fetch';
import { assertSafeFetchUrl } from './url-utils.js';
import httpcloak from 'httpcloak';

export interface HybridExtractResult {
  /** Best markdown output from the winning extractor. */
  markdown: string;
  /** Plain-text version of the best output. */
  text: string;
  /** Page title from the winning extractor. */
  title: string;
  /** Which extractor won and why. */
  winner: 'trafilatura' | 'agent-fetch' | 'merge';
  /** Human-readable reason for the choice. */
  reason: string;
  /** trafilatura's ML quality score (0.0–1.0), if available. */
  trafilaturaQuality: number | null;
  /** agent-fetch's extraction method, if available. */
  agentFetchMethod: string | null;
  /** Text-overlap ratio between the two outputs (0.0–1.0). */
  overlap: number;
  /** Raw HTML that was extracted from. */
  rawHtml: string;
  /** Source URL, if known. */
  url: string;
  /** Whether the output contains markdown tables. */
  hasTables: boolean;
  /** Absolute URLs of hyperlinks found in the raw HTML. */
  links: string[];
}

interface ExtractorOutput {
  markdown: string;
  text: string;
  title: string;
  quality: number | null;
  method: string | null;
  hasTables: boolean;
  hasHeadings: boolean;
  hasLists: boolean;
  wordCount: number;
}

/** Extract and absolutize all http(s) link targets from raw HTML.
 *  Covers <a href>, <link href>, data-next-page-url, data-href, data-url, data-link.
 */
export function extractHtmlLinks(html: string, baseUrl: string): string[] {
  const seen = new Set<string>();
  const links: string[] = [];
  const base = (() => {
    try { return new URL(baseUrl); } catch { return null; }
  })();

  function add(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    try {
      const resolved = base ? new URL(trimmed, base.href).href : trimmed;
      if (!/^https?:\/\//i.test(resolved)) return;
      if (seen.has(resolved)) return;
      seen.add(resolved);
      links.push(resolved);
    } catch { /* invalid URL */ }
  }

  // <a href="...">, <link href="...">
  const hrefRe = /<(a|link)\s+[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    add(m[2] ?? m[3] ?? m[4] ?? '');
  }

  // data-* link attributes (e.g. data-next-page-url, data-href, data-url, data-link)
  const dataRe = /\sdata-(?:next-page-url|href|url|link)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/gi;
  while ((m = dataRe.exec(html)) !== null) {
    add(m[1] ?? m[2] ?? m[3] ?? '');
  }

  // <meta http-equiv="refresh" content="0;url=...">
  const metaRe = /<meta[^>]*?http-equiv\s*=\s*["']?refresh["']?[^>]*?content\s*=\s*["']\d*\s*;\s*url\s*=\s*([^"']*)/gi;
  while ((m = metaRe.exec(html)) !== null) {
    add(m[1] ?? '');
  }

  return links;
}

/** Count words in a text string. */
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Check if markdown contains table rows (| col | col |). */
function markdownHasTables(md: string): boolean {
  return /\|.+\|\n[\s|:-]+/.test(md);
}

/** Check if markdown contains headings (#, ##, etc.). */
function markdownHasHeadings(md: string): boolean {
  return /^#{1,6}\s/m.test(md);
}

/** Check if markdown contains lists (-, *, or 1.). */
function markdownHasLists(md: string): boolean {
  return /^[-*]\s|^\d+\.\s/m.test(md);
}

/**
 * Compute the text-overlap ratio between two markdown outputs.
 * Uses a sliding-window word comparison to measure how much of the
 * shorter text appears in the longer text.
 */
function computeOverlap(textA: string, textB: string): number {
  const wordsA = textA.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const wordsB = textB.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  const [shorter, longer] = wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA];
  if (shorter.length < 5) return 0; // too short for meaningful overlap

  // Build a set of 3-word shingles from the longer text
  const longerShingles = new Set<string>();
  for (let i = 0; i <= longer.length - 3; i++) {
    longerShingles.add(longer.slice(i, i + 3).join(' '));
  }
  if (longerShingles.size === 0) return 0;

  // Count how many of the shorter text's shingles appear in the longer
  let matched = 0;
  let total = 0;
  for (let i = 0; i <= shorter.length - 3; i++) {
    total++;
    if (longerShingles.has(shorter.slice(i, i + 3).join(' '))) matched++;
  }
  return total > 0 ? matched / total : 0;
}

/** Run trafilatura extraction on raw HTML. */
function runTrafilatura(html: string, url?: string): ExtractorOutput {
  try {
    const result = trafilaturaExtract(html, {
      outputMarkdown: true,
      includeImages: false,
      favorPrecision: true,
      ...(url ? { url } : {}),
    });
    const md = result.contentMarkdown ?? '';
    const text = result.contentText ?? '';
    return {
      markdown: md,
      text,
      title: result.metadata?.title ?? '',
      quality: result.extractionQuality ?? null,
      method: result.metadata?.pageType ?? null,
      hasTables: markdownHasTables(md),
      hasHeadings: markdownHasHeadings(md),
      hasLists: markdownHasLists(md),
      wordCount: countWords(text),
    };
  } catch {
    return { markdown: '', text: '', title: '', quality: null, method: null, hasTables: false, hasHeadings: false, hasLists: false, wordCount: 0 };
  }
}

/** Run agent-fetch extraction on raw HTML. */
function runAgentFetch(html: string, url?: string): ExtractorOutput {
  try {
    const result = agentFetchExtract(html, url ?? '');
    if (!result) {
      return { markdown: '', text: '', title: '', quality: null, method: null, hasTables: false, hasHeadings: false, hasLists: false, wordCount: 0 };
    }
    const md = result.markdown ?? '';
    const text = result.textContent ?? '';
    return {
      markdown: md,
      text,
      title: result.title ?? '',
      quality: null, // agent-fetch doesn't expose a quality score
      method: result.method ?? null,
      hasTables: markdownHasTables(md),
      hasHeadings: markdownHasHeadings(md),
      hasLists: markdownHasLists(md),
      wordCount: countWords(text),
    };
  } catch {
    return { markdown: '', text: '', title: '', quality: null, method: null, hasTables: false, hasHeadings: false, hasLists: false, wordCount: 0 };
  }
}

/**
 * Compare the two extractor outputs and pick the winner.
 *
 * Decision logic (evaluated in priority order):
 * 1. If only one produced content, use it.
 * 2. If one has tables and the other doesn't, prefer the one with tables
 *    (tables are critical for structured data and hard to reconstruct).
 * 3. If trafilatura's quality score ≥ 0.7 and its word count is within 20%
 *    of agent-fetch's, prefer trafilatura (high-confidence extraction).
 * 4. If one output is >1.5× longer (more content), prefer it.
 * 5. If overlap is high (>0.8), prefer the one with more structure (tables/headings).
 * 6. If overlap is low (<0.5), merge unique content from both.
 * 7. Default: prefer the longer output.
 */
function pickWinner(
  traf: ExtractorOutput,
  af: ExtractorOutput,
  overlap: number,
): { winner: 'trafilatura' | 'agent-fetch' | 'merge'; reason: string } {
  // 1. Only one produced content
  if (traf.wordCount === 0 && af.wordCount > 0) return { winner: 'agent-fetch', reason: 'trafilatura produced no content' };
  if (af.wordCount === 0 && traf.wordCount > 0) return { winner: 'trafilatura', reason: 'agent-fetch produced no content' };
  if (traf.wordCount === 0 && af.wordCount === 0) return { winner: 'trafilatura', reason: 'both extractors produced no content' };

  // 2. Table presence — tables are critical and hard to reconstruct
  if (traf.hasTables && !af.hasTables) return { winner: 'trafilatura', reason: 'trafilatura preserved tables, agent-fetch did not' };
  if (af.hasTables && !traf.hasTables) return { winner: 'agent-fetch', reason: 'agent-fetch preserved tables, trafilatura did not' };

  // 3. trafilatura high-confidence
  if (traf.quality !== null && traf.quality >= 0.7) {
    const ratio = traf.wordCount / Math.max(af.wordCount, 1);
    if (ratio >= 0.8) return { winner: 'trafilatura', reason: `trafilatura high quality score (${traf.quality.toFixed(2)}) with comparable content` };
  }

  // 4. One output significantly longer
  const lenRatio = traf.wordCount / Math.max(af.wordCount, 1);
  if (lenRatio >= 1.5) return { winner: 'trafilatura', reason: `trafilatura extracted ${traf.wordCount} vs ${af.wordCount} words (1.5× more content)` };
  if (lenRatio <= 0.67) return { winner: 'agent-fetch', reason: `agent-fetch extracted ${af.wordCount} vs ${traf.wordCount} words (1.5× more content)` };

  // 5. High overlap — pick the one with more structural elements
  if (overlap > 0.8) {
    const trafStructure = (traf.hasTables ? 1 : 0) + (traf.hasHeadings ? 1 : 0) + (traf.hasLists ? 1 : 0);
    const afStructure = (af.hasTables ? 1 : 0) + (af.hasHeadings ? 1 : 0) + (af.hasLists ? 1 : 0);
    if (trafStructure > afStructure) return { winner: 'trafilatura', reason: `high overlap (${(overlap * 100).toFixed(0)}%), trafilatura has more structure` };
    if (afStructure > trafStructure) return { winner: 'agent-fetch', reason: `high overlap (${(overlap * 100).toFixed(0)}%), agent-fetch has more structure` };
    // Same structure, same overlap — prefer trafilatura for consistent formatting
    return { winner: 'trafilatura', reason: `high overlap (${(overlap * 100).toFixed(0)}%), similar structure, prefer trafilatura formatting` };
  }

  // 6. Low overlap — extractors diverged, merge unique content
  if (overlap < 0.5 && traf.wordCount > 50 && af.wordCount > 50) {
    return { winner: 'merge', reason: `low overlap (${(overlap * 100).toFixed(0)}%) — merging unique content from both extractors` };
  }

  // 7. Default: prefer the longer output
  if (traf.wordCount >= af.wordCount) return { winner: 'trafilatura', reason: `similar quality, trafilatura slightly longer (${traf.wordCount} vs ${af.wordCount} words)` };
  return { winner: 'agent-fetch', reason: `similar quality, agent-fetch slightly longer (${af.wordCount} vs ${traf.wordCount} words)` };
}

/**
 * Merge two markdown outputs when extractors diverge significantly.
 * Uses the longer output as the base and appends unique paragraphs from
 * the shorter one that don't appear in the base.
 */
function mergeMarkdown(base: string, supplement: string): string {
  const baseParas = base.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  const suppParas = supplement.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  const baseLower = new Set(baseParas.map(p => p.toLowerCase().replace(/\s+/g, ' ')));

  const unique = suppParas.filter(p => {
    const normalized = p.toLowerCase().replace(/\s+/g, ' ');
    // Check if this paragraph (or a close prefix) already exists in base
    return !baseLower.has(normalized) && !baseLower.has(normalized.slice(0, 200));
  });

  if (unique.length === 0) return base;
  return base + '\n\n---\n\n' + unique.join('\n\n');
}

/**
 * Fetch HTML from a URL using httpcloak (browser TLS fingerprint emulation),
 * falling back to Node's built-in fetch. Then run both extractors in parallel
 * and return the validated best result.
 */
export async function hybridFetchAndExtract(url: string, opts?: { timeout?: number }): Promise<HybridExtractResult> {
  assertSafeFetchUrl(url);
  const timeout = opts?.timeout ?? 20000;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };

  let html = '';
  let fetchMethod = 'httpcloak';

  // Strategy 1: httpcloak — emulates browser TLS fingerprint (bypasses JA3/JA4 bot detection)
  try {
    const r = await httpcloak.get(url, { headers, timeout });
    const body = r.text ?? '';
    // Heuristic: if the page is a known bot-protection interstitial, fall through
    if (body.length > 500 && !isBotProtectionPage(body)) {
      html = body;
    } else {
      fetchMethod = 'fetch-fallback';
    }
  } catch {
    fetchMethod = 'fetch-fallback';
  }

  // Strategy 2: Node built-in fetch (fallback)
  if (!html) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(timeout),
        redirect: 'follow',
      });
      if (response.ok) {
        const body = await response.text();
        if (!isBotProtectionPage(body)) {
          html = body;
          fetchMethod = 'fetch';
        }
      }
    } catch {
      // continue to empty result
    }
  }

  if (!html) {
    return {
      markdown: '', text: '', title: '', winner: 'trafilatura', reason: 'No content fetched (bot protection or network error)',
      trafilaturaQuality: null, agentFetchMethod: fetchMethod, overlap: 0, rawHtml: '', url,
      hasTables: false,
      links: [],
    };
  }

  const result = hybridExtractFromHtml(html, url);
  return { ...result, agentFetchMethod: result.agentFetchMethod ?? fetchMethod };
}

/** Detect common bot-protection interstitial pages. */
function isBotProtectionPage(html: string): boolean {
  if (html.length < 1000) return true;
  const lower = html.toLowerCase();
  // reCAPTCHA challenge page
  if (lower.includes('recaptcha/challengepage') && !lower.includes('references')) return true;
  // "Checking your browser" interstitial
  if (lower.includes('checking your browser') && lower.includes('recaptcha')) return true;
  // Cloudflare challenge
  if (lower.includes('cf-challenge') || lower.includes('cf-browser-verification')) return true;
  return false;
}

/**
 * Run both extractors on the same HTML in parallel and return the
 * validated best result.
 */
export function hybridExtractFromHtml(html: string, url?: string): HybridExtractResult {
  // Run both extractors (synchronous, but wrapped for future async compatibility)
  const traf = runTrafilatura(html, url);
  const af = runAgentFetch(html, url);

  // Compute overlap between the two text outputs
  const overlap = computeOverlap(traf.text, af.text);

  // Pick the winner
  const { winner, reason } = pickWinner(traf, af, overlap);

  // Assemble the final result
  let markdown: string;
  let text: string;
  let title: string;

  switch (winner) {
    case 'trafilatura':
      markdown = traf.markdown;
      text = traf.text;
      title = traf.title;
      break;
    case 'agent-fetch':
      markdown = af.markdown;
      text = af.text;
      title = af.title;
      break;
    case 'merge': {
      // Use the longer output as base, supplement with unique paragraphs from the other
      const [base, supplement] = traf.wordCount >= af.wordCount
        ? [traf.markdown, af.markdown]
        : [af.markdown, traf.markdown];
      markdown = mergeMarkdown(base, supplement);
      text = traf.wordCount >= af.wordCount ? traf.text : af.text;
      title = traf.title || af.title;
      break;
    }
  }

  return {
    markdown,
    text,
    title,
    winner,
    reason,
    trafilaturaQuality: traf.quality,
    agentFetchMethod: af.method,
    overlap,
    rawHtml: html,
    url: url ?? '',
    hasTables: markdownHasTables(markdown),
    links: extractHtmlLinks(html, url ?? ''),
  };
}
