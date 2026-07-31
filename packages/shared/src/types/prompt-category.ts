/**
 * Pre-defined turn categories for the Mixture-of-Experts prompt assembler.
 *
 * These are used by the `CategoryDetector` to select a specialized prompt
 * profile and, optionally, a narrower tool set per turn.
 */
export type TurnCategory =
  | 'coding'
  | 'content'
  | 'creative'
  | 'research'
  | 'websearch'
  | 'analysis'
  | 'datascience'
  | 'communication'
  | 'finance'
  | 'marketing'
  | 'documentation'
  | 'general';

/** Ordered list of all supported turn categories. */
export const TURN_CATEGORIES: TurnCategory[] = [
  'coding',
  'content',
  'creative',
  'research',
  'websearch',
  'analysis',
  'datascience',
  'communication',
  'finance',
  'marketing',
  'documentation',
  'general',
];

/** Sub-category is intentionally open-ended; detectors can return any label. */
export type TurnSubCategory = string;
