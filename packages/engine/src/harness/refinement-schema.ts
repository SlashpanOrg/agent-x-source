import { z } from 'zod';
import type { RefinementProposal } from '@agentx/shared';

const refinementEditSchema = z.object({
  action: z.enum(['create', 'update', 'delete']),
  kind: z.enum(['prompt', 'memory', 'skill', 'subagent']),
  id: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  path: z.string().optional(),
  reference: z.record(z.unknown()).optional(),
  arguments: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  reason: z.string().optional(),
});

const refinementProposalSchema = z.object({
  summary: z.string(),
  rationale: z.string(),
  edits: z.array(refinementEditSchema).min(1),
});

export function validateRefinementProposal(raw: unknown): RefinementProposal | null {
  const parsed = refinementProposalSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
