const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`([^`]+)`/g;
const LINK_RE = /\[([^\]]+)\]\([^)]+\)/g;
const HEADING_RE = /^#{1,6}\s+/gm;
const BOLD_RE = /\*\*([^*]+)\*\*/g;
const ITALIC_RE = /\*([^*]+)\*/g;
const XML_TAG_RE = /<\/?[a-zA-Z][^>]*>/g;
const UNICODE_TAG_RE = /[⟨⟩][^⟨⟩]*[⟨⟩]/g;
const BARE_URL_RE = /https?:\/\/[^\s]+/gi;
const MAX_SPOKEN_CHARS = 4000;

function spokenHostFromUrl(raw: string): string {
  try {
    const host = new URL(raw).hostname
      .replace(/^www\./i, '')
      .replace(/^(images|cdn|static|media|assets|img)\./i, '');
    return host || 'a web page';
  } catch {
    return 'a web page';
  }
}

export interface NormalizeSpeechOptions {
  maxChars?: number;
  summarizeCodeBlocks?: boolean;
}

export function normalizeTextForSpeech(text: string, options: NormalizeSpeechOptions = {}): string {
  const maxChars = options.maxChars ?? MAX_SPOKEN_CHARS;
  let out = text.trim();
  if (!out) return '';

  out = out.replace(CODE_BLOCK_RE, options.summarizeCodeBlocks === false ? ' code block ' : ' code snippet omitted ');
  out = out.replace(INLINE_CODE_RE, '$1');
  out = out.replace(LINK_RE, '$1');
  out = out.replace(HEADING_RE, '');
  out = out.replace(BOLD_RE, '$1');
  out = out.replace(ITALIC_RE, '$1');
  out = out.replace(XML_TAG_RE, ' ');
  out = out.replace(UNICODE_TAG_RE, ' ');
  out = out.replace(BARE_URL_RE, (url) => spokenHostFromUrl(url));
  out = out.replace(/[#>*_~|]/g, ' ');
  out = out.replace(/\s+/g, ' ').trim();

  if (out.length > maxChars) {
    out = `${out.slice(0, maxChars - 40).trim()}… I can continue if you ask.`;
  }
  return out;
}
