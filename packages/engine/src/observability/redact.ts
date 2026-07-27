/**
 * Prompt redaction + secret scrubbing for observability attributes.
 *
 * - When `capturePrompts = false`, prompt/response/tool-arg/retrieval/user-text
 *   attributes are replaced with `[redacted:N]` (N = original length) so the
 *   shape and size of the turn is still visible without leaking PII.
 * - Secret scrubbing is ALWAYS on (regardless of capturePrompts): any attribute
 *   whose key looks like a secret (`apiKey`, `api_key`, `authorization`,
 *   `token`, `password`, `secret`) is replaced with `[secret]`.
 *
 * Token counts, tool names, durations, statuses, and structural metadata are
 * always preserved.
 */

const SECRET_KEY_RE = /(^|_)(apikey|api_key|authorization|token|password|secret|passwd)(_|$)/i;

const PROMPT_ATTRS = new Set([
  'llm.input_messages',
  'llm.output_messages',
  'tool.args',
  'tool.output',
  'retrieval.query',
  'user.text',
]);

/** Attributes whose *content* must be redacted but whose score/metadata kept. */
const DOCUMENT_ATTRS = new Set(['retrieval.documents']);

function redactValue(value: unknown): string {
  const len = typeof value === 'string' ? value.length : JSON.stringify(value ?? '').length;
  return `[redacted:${len}]`;
}

function scrubSecrets(attrs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (SECRET_KEY_RE.test(key)) {
      out[key] = '[secret]';
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = scrubSecrets(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function redactDocuments(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((doc) => {
      if (doc && typeof doc === 'object') {
        const d = doc as Record<string, unknown>;
        const content = d['content'];
        return {
          ...d,
          content: typeof content === 'string' ? redactValue(content) : content,
        };
      }
      return doc;
    });
  }
  if (typeof value === 'string') return redactValue(value);
  return value;
}

/**
 * Redact observability span attributes.
 * @param attrs raw span attributes
 * @param capturePrompts when false, prompt/response/tool-arg/retrieval/user-text
 *   values are replaced with `[redacted:N]`.
 * @returns a new object; the input is not mutated.
 */
export function redactAttributes(
  attrs: Record<string, unknown>,
  capturePrompts: boolean,
): Record<string, unknown> {
  // Secret scrubbing is always applied first.
  let out = scrubSecrets(attrs);
  if (capturePrompts) return out;

  out = { ...out };
  for (const key of Object.keys(out)) {
    if (PROMPT_ATTRS.has(key)) {
      out[key] = redactValue(out[key]);
    } else if (DOCUMENT_ATTRS.has(key)) {
      out[key] = redactDocuments(out[key]);
    }
  }
  return out;
}

/** Redact a single string field (e.g. `traces.user_text`). */
export function redactText(value: string | undefined, capturePrompts: boolean): string | undefined {
  if (!value) return value;
  if (capturePrompts) return value;
  return `[redacted:${value.length}]`;
}
