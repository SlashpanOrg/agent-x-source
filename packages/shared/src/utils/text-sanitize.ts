/**
 * Remove lone UTF-16 surrogates that break JSON serialization for LLM APIs.
 */
export function sanitizeForJson(text: string): string {
  if (!text) return text;
  // Replace unpaired surrogates with U+FFFD
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

/** Fenced code (```…```) including an unclosed fence to EOS, plus inline `code`. */
const CODE_SEGMENT_RE = /```[\s\S]*?(?:```|$)|`[^`\n]+`/g;

/**
 * Map over prose only — never rewrite fenced or inline code segments so intentional
 * raw escapes in examples stay visible.
 */
export function mapOverNonCodeSegments(text: string, mapProse: (prose: string) => string): string {
  if (!text) return text;
  const out: string[] = [];
  let last = 0;
  for (const match of text.matchAll(CODE_SEGMENT_RE)) {
    const start = match.index ?? 0;
    if (start > last) out.push(mapProse(text.slice(last, start)));
    out.push(match[0]!);
    last = start + match[0]!.length;
  }
  if (last < text.length) out.push(mapProse(text.slice(last)));
  return out.join('');
}

function codePointFromHex(hex: string): string | null {
  const code = Number.parseInt(hex, 16);
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return null;
  if (code >= 0xd800 && code <= 0xdfff) return '\uFFFD';
  try {
    return String.fromCodePoint(code);
  } catch {
    return null;
  }
}

/** True for zero-width / bidi / BOM format chars we never want in chat prose. */
function isInvisibleFormatCodePoint(code: number): boolean {
  return (
    code === 0x00ad // soft hyphen
    || code === 0x034f // combining grapheme joiner
    || code === 0x061c // Arabic letter mark
    || code === 0x180e // Mongolian vowel separator
    || (code >= 0x200b && code <= 0x200f) // ZWSP, ZWNJ, ZWJ, LRM, RLM
    || (code >= 0x202a && code <= 0x202e) // bidi embedding
    || (code >= 0x2060 && code <= 0x2064) // word joiner…invisible plus
    || (code >= 0x2066 && code <= 0x206f) // bidi isolates
    || code === 0xfeff // BOM / ZWNBSP
    || code === 0xfff9 || code === 0xfffa || code === 0xfffb // interlinear
  );
}

/**
 * Decode JSON/JS/HTML-style unicode escapes the model sometimes emits as literal text
 * (e.g. `office/\u200cbranch`). Code fences and inline `code` are left untouched.
 */
export function decodeLiteralUnicodeEscapes(text: string): string {
  if (!text) return text;

  const decodeProseOnce = (chunk: string): string => {
    let out = chunk;

    // Collapse over-escaped forms (\\\\u200c → \\u200c) before decoding.
    out = out.replace(/\\{2,}(u\{[0-9a-fA-F]{1,6}\}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|x[0-9a-fA-F]{2})/g, '\\$1');

    // \u{1F4A1} | \u200c | \U0000200C
    out = out.replace(/\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|\\U([0-9a-fA-F]{8})/g, (match, braced, u4, u8) => {
      const decoded = codePointFromHex((braced || u4 || u8) as string);
      return decoded ?? match;
    });

    // \xNN (common in model dumps)
    out = out.replace(/\\x([0-9a-fA-F]{2})/g, (match, hex) => {
      const decoded = codePointFromHex(hex as string);
      return decoded ?? match;
    });

    // HTML numeric / named entities for format chars and general numeric refs
    out = out.replace(/&#x([0-9a-fA-F]{1,6});/gi, (match, hex) => {
      const decoded = codePointFromHex(hex as string);
      return decoded ?? match;
    });
    out = out.replace(/&#([0-9]{1,7});/g, (match, dec) => {
      const code = Number.parseInt(dec as string, 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      if (code >= 0xd800 && code <= 0xdfff) return '\uFFFD';
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    });
    out = out.replace(/&zwnj;/gi, '\u200c');
    out = out.replace(/&zwj;/gi, '\u200d');
    out = out.replace(/&lrm;/gi, '\u200e');
    out = out.replace(/&rlm;/gi, '\u200f');

    // Bare U+200C / U+FEFF style tags for invisible format code points only
    out = out.replace(/\bU\+([0-9a-fA-F]{4,6})\b/g, (match, hex) => {
      const code = Number.parseInt(hex as string, 16);
      if (!Number.isFinite(code) || !isInvisibleFormatCodePoint(code)) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    });

    return out;
  };

  return mapOverNonCodeSegments(text, (prose) => {
    let out = prose;
    // Nested escaping (\\\\u200c → \\u200c → char)
    for (let i = 0; i < 4; i++) {
      const next = decodeProseOnce(out);
      if (next === out) break;
      out = next;
    }
    return out;
  });
}

/** Zero-width / format chars that often leak from PDF/OCR or model escapes. */
// eslint-disable-next-line no-misleading-character-class -- intentional Unicode invisible/format range list
const INVISIBLE_FORMAT_CHARS = /[\u00AD\u034F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]/g;

export function stripInvisibleFormatChars(text: string): string {
  if (!text) return text;
  // Never strip inside code — invisibles there may be intentional examples.
  return mapOverNonCodeSegments(text, (prose) => prose.replace(INVISIBLE_FORMAT_CHARS, ''));
}

/**
 * After decoding, remove any leftover *literal* escape spellings for invisible
 * format chars that failed to decode (e.g. broken `\\ u200c`). Code blocks kept.
 */
export function stripResidualInvisibleEscapeSpellings(text: string): string {
  if (!text) return text;
  return mapOverNonCodeSegments(text, (prose) => prose
    .replace(/\\u\{?(200[b-fB-F]|206[0-9a-fA-F]|feff|00ad|034f|061c|180e)\}?/gi, '')
    .replace(/\\x(?:ad|c2ad)/gi, '')
    .replace(/&#x?(?:200[b-f]|206[0-9a-f]|feff|00ad);?/gi, '')
    .replace(/&zwnj;|&zwj;|&lrm;|&rlm;/gi, '')
    .replace(/\bU\+(?:200[B-F]|206[0-9A-F]|FEFF|00AD|034F|061C|180E)\b/gi, ''));
}

/**
 * Chat display sanitizer: decode literal escapes + drop invisible format chars in
 * prose. Fenced ```code``` and inline `code` are never rewritten.
 */
export function sanitizeAssistantDisplayText(text: string): string {
  if (!text) return text;
  return stripResidualInvisibleEscapeSpellings(
    stripInvisibleFormatChars(decodeLiteralUnicodeEscapes(text)),
  );
}

/** Patterns injected into assistant content by the stream handler (legacy + current). */
const TOOL_NOISE_PATTERNS = [
  /\n?🔧 Calling: [^\n]+/g,
  /\n?✅ Result: [^\n]+/g,
  /\n?━{10,}[^\n]*\n?/g,
  /\n?\[STEP \d+\][^\n]*/g,
  /\n?\[STEP \d+ COMPLETE\][^\n]*/g,
];

/** Strip tool-call/result noise from persisted or streamed assistant text. */
export function stripToolNoise(content: string, options?: { trim?: boolean }): string {
  if (!content) return '';
  let out = sanitizeAssistantDisplayText(content);
  for (const re of TOOL_NOISE_PATTERNS) {
    out = out.replace(re, '');
  }
  out = out.replace(/\n{3,}/g, '\n\n');
  return options?.trim === false ? out : out.trim();
}
