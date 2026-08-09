/**
 * Inline chat history record for a completed permission decision.
 * Shown as a compact chip so users can see what was asked and how they responded.
 */

export type PermissionOutcomeDecision =
  | 'allow_once'
  | 'allow_always'
  | 'deny'
  | 'instructed'
  | 'declined_consent';

export interface PermissionOutcomeRecord {
  toolId: string;
  toolName?: string;
  path?: string;
  riskLevel?: string;
  decision: PermissionOutcomeDecision;
  /** Short human label, e.g. "Allowed once" / "Denied" / "Instructed". */
  label: string;
  /** Optional user instruction text when decision is instructed. */
  instruction?: string;
  /** Brief action description shown during consent, e.g. "write file report.md". */
  actionSummary?: string;
  decidedAt: string;
}
