/** How long a spoken voice permission prompt waits before auto-cancelling. */
export const VOICE_PERMISSION_TIMEOUT_MS = 30_000;

/** Quiet window to collect parallel tool permission requests into one spoken ask. */
export const VOICE_PERMISSION_COLLECT_MS = 650;

/** Max times we re-ask when the utterance is not clearly yes or no. */
export const VOICE_PERMISSION_MAX_CLARIFY = 2;

/** Honest tool-result instruction when the user ignores the spoken permission prompt. */
export const VOICE_PERMISSION_TIMEOUT_INSTRUCTION =
  'Permission request timed out after 30 seconds with no clear spoken confirmation. '
  + 'The tool action was NOT performed. Do not claim it succeeded — '
  + 'ask the user to approve again if the action is still needed.';

export const VOICE_PERMISSION_CLARIFY_LINE =
  "I didn't catch a clear yes or no. Should I go ahead with those tools, or skip them?";
