/** Deliverable tools that must not run proactively without user confirmation. */
export const PROACTIVE_DELIVERABLE_TOOLS = new Set([
  'save_to_markdown',
  'gen_markdown',
  'gen_html',
  'pdf_create',
  'docx_create',
  'xlsx_create',
  'pptx_create',
  'csv_create',
  'file_write',
  'write_file',
  'file_edit',
  'edit_file',
  'apply_patch',
]);

const SESSION_WAIVER_RE = /\b(no need to ask(?: me)?(?: for)? permission|don'?t ask(?: me)?(?: for)? permission|do not ask(?: me)?(?: for)? permission|just (?:carry on|continue|proceed|do it)|carry on without asking|skip (?:the )?permission|auto[- ]?approve|you (?:have|got) (?:my )?permission)\b/i;

const EXPLICIT_DELIVERABLE_REQUEST_RE = /\b(save|export|write|create|generate|make|store|persist)\b[\s\S]{0,80}\b(markdown|md|pdf|docx|xlsx|pptx|csv|document|report|file|itinerary|plan|deliverable)\b|\b(save|export)\s+(this|it|that|to)\b|\bwrite (?:it|this|that) (?:to|as|into)\b/i;

export function isProactiveDeliverableTool(toolId: string): boolean {
  return PROACTIVE_DELIVERABLE_TOOLS.has(toolId);
}

/** Session-level waiver for low-risk proactive deliverable consent. */
export function detectsSessionProactiveConsentWaiver(text: string): boolean {
  return SESSION_WAIVER_RE.test(text.trim());
}

/** True when the current user turn explicitly asked for a save/create deliverable. */
export function detectsExplicitDeliverableRequest(text: string): boolean {
  return EXPLICIT_DELIVERABLE_REQUEST_RE.test(text.trim());
}

export function proactiveDeliverableConsentInstruction(toolId: string): string {
  const label = toolId.replace(/_/g, ' ');
  return (
    `Do not call ${toolId} yet. Ask the user one short plain-text question confirming whether they want you to ${label} now, then STOP this turn and wait for their reply. `
    + 'Do not use ask_clarification for this confirmation. If they say yes / proceed / save it, call the tool on the next turn.'
  );
}
