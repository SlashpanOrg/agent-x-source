/** Canonical color tokens for assistant HTML so GFM tables always render. */

const COLOR_ALIASES: Record<string, string> = {
  red: '#ef5350',
  green: '#66bb6a',
  blue: '#42a5f5',
  orange: '#ffa726',
  yellow: '#ffee58',
  purple: '#ab47bc',
  gray: '#90a4ae',
  grey: '#90a4ae',
  black: '#eceff1',
  white: '#eceff1',
  crimson: '#ef5350',
  darkred: '#ef5350',
  lime: '#66bb6a',
  darkgreen: '#66bb6a',
  navy: '#42a5f5',
  dodgerblue: '#42a5f5',
  coral: '#ffa726',
  gold: '#ffee58',
};

const REF_FILE_RE = /<ref_file\s+file=["']([^"']+)["']\s*\/?>/gi;
const REF_SNIPPET_RE = /<ref_snippet\s+file=["']([^"']+)["'](?:\s+lines=["']([^"']+)["'])?\s*\/?>/gi;
const COLOR_TOKEN_RE = /⟦axc:([^⟧]+)⟧([\s\S]*?)⟦\/axc⟧/g;
const INNERMOST_TAG_RE = /<([a-zA-Z][\w:-]*)(\s[^>]*)?>([^<]*)<\/\1\s*>/g;
const SELF_CLOSING_RE = /<([a-zA-Z][\w:-]*)(\s[^>]*)?\/>/g;
const LEFTOVER_TAG_RE = /<\/?[a-zA-Z][\w:-]*(\s[^>]*)?>/g;

export type ColoredSegment =
  | { kind: 'text'; text: string }
  | { kind: 'color'; color: string; text: string };

function fileBase(path: string): string {
  const trimmed = path.trim();
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Map any CSS/HTML color spelling onto the shared palette (or a safe hex). */
export function resolveColor(raw: string): string | null {
  const t = raw.trim().toLowerCase().replace(/[;]+$/g, '');
  if (!t) return null;
  if (COLOR_ALIASES[t]) return COLOR_ALIASES[t];
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t)) {
    if (t.length === 4) {
      return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`;
    }
    return t;
  }
  const rgb = t.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) return rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  return null;
}

function decodeEntities(input: string): string {
  if (!input.includes('&')) return input;
  return input
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}

function extractColorFromAttrs(attrs: string | undefined): string | null {
  if (!attrs) return null;
  const styleMatch = attrs.match(/style\s*=\s*(["'])([\s\S]*?)\1/i)
    ?? attrs.match(/style\s*=\s*([^\s>]+)/i);
  const style = styleMatch?.[2] ?? styleMatch?.[1] ?? '';
  const fromStyle = style.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)?.[1];
  const fromAttr = attrs.match(/(?:^|\s)color\s*=\s*(["']?)([^"'\s>]+)\1/i)?.[2];
  return resolveColor((fromStyle || fromAttr || '').trim());
}

function wrapColor(color: string, inner: string): string {
  if (!inner) return '';
  if (inner.includes('⟦axc:')) return inner;
  return `⟦axc:${color}⟧${inner}⟦/axc⟧`;
}

function flattenHtmlKeepingColor(input: string): string {
  let out = input.replace(/<br\s*\/?>/gi, '\n');
  let guard = 0;
  while (guard++ < 12 && /<[a-zA-Z]/.test(out)) {
    const before = out;
    INNERMOST_TAG_RE.lastIndex = 0;
    out = out.replace(INNERMOST_TAG_RE, (_m, _tag: string, attrs: string | undefined, inner: string) => {
      const color = extractColorFromAttrs(attrs);
      return color ? wrapColor(color, inner) : inner;
    });
    SELF_CLOSING_RE.lastIndex = 0;
    out = out.replace(SELF_CLOSING_RE, (_m, tag: string) => {
      const name = String(tag).toLowerCase();
      if (name === 'br') return '\n';
      if (name === 'ref_file' || name === 'ref_snippet') return _m;
      return '';
    });
    if (out === before) break;
  }
  return out.replace(LEFTOVER_TAG_RE, '');
}

function replaceRefs(input: string): string {
  return input
    .replace(REF_FILE_RE, (_, file: string) => {
      const name = fileBase(file);
      return `[${name}](ax-ref-file:${encodeURIComponent(file)})`;
    })
    .replace(REF_SNIPPET_RE, (_, file: string, lines?: string) => {
      const name = fileBase(file);
      const label = lines ? `${name}:${lines}` : name;
      const href = lines
        ? `ax-ref-snippet:${encodeURIComponent(file)}?lines=${encodeURIComponent(lines)}`
        : `ax-ref-file:${encodeURIComponent(file)}`;
      return `[${label}](${href})`;
    });
}

function transformOutsideCode(content: string, transform: (chunk: string) => string): string {
  const fences = content.split(/(```[\s\S]*?```)/g);
  return fences.map((block) => {
    if (block.startsWith('```')) return block;
    return block.split(/(`[^`]*`)/g).map((part) => (
      part.startsWith('`') && part.endsWith('`') && part.length >= 2 ? part : transform(part)
    )).join('');
  }).join('');
}

/**
 * Collapse model HTML (any tag + color attr/style, escaped or raw) into
 * `⟦axc:#hex⟧text⟦/axc⟧` so one renderer handles chat, tables, and PDF.
 */
export function prepareAssistantMarkup(content: string): string {
  if (!content) return content;
  if (!content.includes('<') && !content.includes('&lt;') && !content.includes('&quot;')) {
    return content;
  }
  return transformOutsideCode(content, (chunk) => {
    const decoded = decodeEntities(chunk);
    return flattenHtmlKeepingColor(replaceRefs(decoded));
  });
}

export function splitColoredMarkup(text: string): ColoredSegment[] {
  if (!text.includes('⟦axc:')) return [{ kind: 'text', text }];
  const out: ColoredSegment[] = [];
  let last = 0;
  COLOR_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = COLOR_TOKEN_RE.exec(text))) {
    if (match.index > last) {
      out.push({ kind: 'text', text: text.slice(last, match.index) });
    }
    out.push({ kind: 'color', color: match[1]!, text: match[2] ?? '' });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out.length ? out : [{ kind: 'text', text }];
}

export function isRefFileHref(href: string | undefined): boolean {
  return !!href && (href.startsWith('ax-ref-file:') || href.startsWith('ax-ref-snippet:'));
}

export function refFileNameFromHref(href: string): string {
  const raw = href.startsWith('ax-ref-snippet:')
    ? href.slice('ax-ref-snippet:'.length).split('?')[0] ?? ''
    : href.slice('ax-ref-file:'.length);
  try {
    return fileBase(decodeURIComponent(raw));
  } catch {
    return fileBase(raw);
  }
}
