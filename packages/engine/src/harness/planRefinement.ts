import type { HarnessScope } from '@agentx/shared';
import { REFINEMENT_PLANNER_PROMPT } from './refinement-prompt.js';
import { parseRefinementProposal } from './applyRefinement.js';
import { validateRefinementProposal } from './refinement-schema.js';

export interface PlanRefinementInput {
  scope: HarnessScope;
  sessionId?: string;
  instructions?: string;
  trajectorySummary: string;
  complete: (prompt: string) => Promise<string>;
}

export async function planRefinement(input: PlanRefinementInput): Promise<{
  proposal: ReturnType<typeof parseRefinementProposal>;
  raw: string;
}> {
  const userBlock = [
    input.instructions ? `User refine instructions: ${input.instructions}` : '',
    `Scope: ${input.scope}`,
    input.sessionId ? `Session: ${input.sessionId}` : '',
    'Trajectory:',
    input.trajectorySummary,
  ]
    .filter(Boolean)
    .join('\n');

  const prompt = `${REFINEMENT_PLANNER_PROMPT}\n\n${userBlock}`;
  const raw = await input.complete(prompt);
  const parsed = parseRefinementProposal(raw);
  const proposal = parsed ? validateRefinementProposal(parsed) ?? parsed : null;
  return { proposal, raw };
}
