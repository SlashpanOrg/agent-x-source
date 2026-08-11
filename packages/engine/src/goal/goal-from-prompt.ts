import type { GoalBudget, ThinkingMode } from '@agentx/shared';
import { isGoalsEnabled } from '@agentx/shared';
import { getGoalService } from './GoalService.js';

const GREETING_RE = /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|yo|sup)[\s!.?,]*$/i;

const INFORMATIONAL_RE =
  /^(tell me about|what is|what are|who is|who are|explain|describe|summarize|overview of|give me (an )?overview|how does|how do)\b/i;

/** User is asking for information, not a multi-step execution task. */
export function isInformationalUserQuery(text: string): boolean {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed) return false;
  if (/\b(fix|implement|build|create|deploy|write code|refactor|migrate|automate|set up)\b/i.test(lower)) {
    return false;
  }
  return INFORMATIONAL_RE.test(trimmed);
}

/** Derive a session goal objective from the user's message (no UI). */
export function extractGoalObjectiveFromUserText(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 12) return null;
  if (GREETING_RE.test(trimmed)) return null;
  return trimmed.slice(0, 2000);
}

export function inferGoalBudget(userText: string): GoalBudget {
  if (isInformationalUserQuery(userText)) {
    return { maxContinuations: 0 };
  }
  return { maxContinuations: 3 };
}

/**
 * When the user sends a normal message, align the persistent goal with their prompt.
 * Skips light mode and informational Q&A (single-turn answers).
 */
export function maybeSyncGoalFromUserPrompt(
  sessionId: string,
  userText: string,
  thinkingMode?: ThinkingMode,
): void {
  if (!isGoalsEnabled()) return;
  if (thinkingMode === 'light') return;
  if (isInformationalUserQuery(userText)) return;

  const objective = extractGoalObjectiveFromUserText(userText);
  if (!objective) return;

  const goals = getGoalService();
  const current = goals.getStatus(sessionId);
  const budget = inferGoalBudget(userText);

  if (current.status === 'idle') {
    try {
      goals.activate(sessionId, objective, budget);
    } catch {
      /* best-effort */
    }
    return;
  }

  if (current.status === 'active' && current.objective !== objective) {
    try {
      goals.activate(sessionId, objective, budget);
    } catch {
      /* best-effort */
    }
  }
}
