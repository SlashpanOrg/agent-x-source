import { sanitizeArticleDeliverable } from './article-deliverable.js';

/** Extract article body from legacy auto-wrapped TSX shells. */
export function extractArticleFromLegacyTsx(tsx: string): string | null {
  const trimmed = tsx.trim();
  if (!trimmed) return null;

  const tryParseJsonString = (raw: string): string | null => {
    const candidate = raw.trim();
    if (!candidate.startsWith('"') && !candidate.startsWith("'")) return null;
    try {
      const parsed = JSON.parse(candidate);
      return typeof parsed === 'string' ? parsed : null;
    } catch {
      return null;
    }
  };

  const jsxJson = trimmed.match(/<Markdown>\s*\{\s*("(?:\\.|[^"\\])*")\s*\}\s*<\/Markdown>/s);
  if (jsxJson?.[1]) {
    const parsed = tryParseJsonString(jsxJson[1]);
    if (parsed) return parsed;
  }

  const directJson = trimmed.match(/<Markdown>\s*("(?:\\.|[^"\\])*")\s*<\/Markdown>/s);
  if (directJson?.[1]) {
    const parsed = tryParseJsonString(directJson[1]);
    if (parsed) return parsed;
  }

  const tplExpr = trimmed.match(/<Markdown>\s*\{\s*`((?:\\.|[^`])*)`\s*\}\s*<\/Markdown>/s);
  if (tplExpr?.[1]) {
    return tplExpr[1]
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\`/g, '`')
      .replace(/\\\\/g, '\\');
  }

  const childText = trimmed.match(/<Markdown>\s*([^<{][\s\S]*?)\s*<\/Markdown>/);
  if (childText?.[1]?.trim()) return childText[1].trim();

  return null;
}

/** Normalize article save input (legacy TSX is converted when possible). */
export function normalizeArticleInput(input: {
  content?: string;
  contentTsx?: string;
  title?: string;
}): string | null {
  const body = input.content?.trim();
  if (body) {
    return sanitizeArticleDeliverable(body, { title: input.title });
  }

  const tsx = input.contentTsx?.trim();
  if (!tsx) return null;

  const extracted = extractArticleFromLegacyTsx(tsx);
  if (extracted) {
    return sanitizeArticleDeliverable(extracted, { title: input.title });
  }

  const title = (input.title?.trim() || 'Article').slice(0, 120);
  return [
    `# ${title}`,
    '',
    '> Saved from a legacy interactive artifact. Source preserved below.',
    '',
    '```tsx',
    tsx,
    '```',
  ].join('\n');
}
