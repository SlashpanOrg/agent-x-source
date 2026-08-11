import {
  compileRichResponseDocument,
  responseDocumentPart,
  type Message,
  type MessagePart,
} from '@agentx/shared';

export type RichResponseMode = 'off' | 'shadow' | 'on';

/** Rich final answers are enabled in code. No env toggle. */
const RICH_RESPONSE_MODE: RichResponseMode = 'on';

export interface RichResponseDecision {
  mode: RichResponseMode;
  selected: boolean;
  attached: boolean;
  reason: string;
  elapsedMs: number;
  parity?: number;
  error?: string;
}

const disabledSessions = new Set<string>();

/** Server-owned mode. Absent from user settings UI. */
export function getRichResponseMode(sessionId?: string): RichResponseMode {
  if (sessionId && disabledSessions.has(sessionId)) return 'off';
  return RICH_RESPONSE_MODE;
}

/** Emergency per-session fallback to canonical Markdown; no data migration is needed. */
export function disableRichResponseForSession(sessionId: string): void {
  if (sessionId) disabledSessions.add(sessionId);
}

export function enableRichResponseForSession(sessionId: string): void {
  disabledSessions.delete(sessionId);
}

export function isRichResponseDisabledForSession(sessionId: string): boolean {
  return disabledSessions.has(sessionId);
}

function latestRevision(parts: MessagePart[], id: string): number {
  let revision = 0;
  for (const part of parts) {
    if (part.type !== 'response_document' || part.id !== id) continue;
    revision = Math.max(revision, part.responseDocument?.revision ?? 1);
  }
  return revision;
}

export function applyRichResponsePolicy(
  sessionId: string,
  message: Message,
  context?: {
    category?: string;
    outputMode?: 'brief' | 'moderate' | 'detailed';
    voiceTurn?: boolean;
  },
): { message: Message; decision: RichResponseDecision } {
  const mode = getRichResponseMode(sessionId);
  if (mode === 'off' || context?.voiceTurn || message.role !== 'assistant' || !message.content?.trim()) {
    return {
      message,
      decision: {
        mode,
        selected: false,
        attached: false,
        reason: mode === 'off'
          ? 'feature-off'
          : context?.voiceTurn
            ? 'voice-turn'
            : 'ineligible-message',
        elapsedMs: 0,
      },
    };
  }

  const parts = Array.isArray(message.parts) ? message.parts as MessagePart[] : [];
  const partId = `response-${message.id}`;
  const revision = latestRevision(parts, partId) + 1;
  const result = compileRichResponseDocument({
    content: message.content,
    category: context?.category,
    outputMode: context?.outputMode,
    revision,
  });
  if (!result.selected) {
    return {
      message,
      decision: {
        mode,
        selected: false,
        attached: false,
        reason: result.reason,
        elapsedMs: result.elapsedMs,
        ...(result.error ? { error: result.error } : {}),
      },
    };
  }

  if (mode === 'shadow') {
    return {
      message,
      decision: {
        mode,
        selected: true,
        attached: false,
        reason: result.reason,
        elapsedMs: result.elapsedMs,
        parity: result.parity,
      },
    };
  }

  const richPart = responseDocumentPart(partId, result.document, result.fallbackMarkdown);
  if (!richPart) {
    return {
      message,
      decision: {
        mode,
        selected: false,
        attached: false,
        reason: 'part-validation-failed',
        elapsedMs: result.elapsedMs,
      },
    };
  }
  const withoutPriorSnapshot = parts.filter((part) => (
    part.type !== 'response_document' || part.id !== partId
  ));
  return {
    message: {
      ...message,
      parts: [...withoutPriorSnapshot, richPart],
    },
    decision: {
      mode,
      selected: true,
      attached: true,
      reason: result.reason,
      elapsedMs: result.elapsedMs,
      parity: result.parity,
    },
  };
}
