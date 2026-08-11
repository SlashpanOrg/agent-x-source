/** Turn ends after an assistant clarification question; user reply starts a new turn. */
export const CLARIFICATION_AWAITING_USER = 'CLARIFICATION_AWAITING_USER';

export function isClarificationAwaitingUserError(error: unknown): boolean {
  return error instanceof Error && error.message === CLARIFICATION_AWAITING_USER;
}
