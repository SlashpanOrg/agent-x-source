import type { AdoptionFeatureFlags, OutputMode, ThinkingMode } from '@agentx/shared';
import { getAdoptionFeatureFlags, setAdoptionTurnOverrides } from '@agentx/shared';
import { isInformationalUserQuery } from '../goal/goal-from-prompt.js';
import { profileRequest } from '../agent/request-profile.js';

export interface AdoptionTurnContext {
  sessionId: string;
  userText: string;
  goalContinuation?: boolean;
  sourceChannel?: string;
  voiceTurn?: boolean;
  thinkingMode?: ThinkingMode;
  outputMode?: OutputMode;
}

function lightAdoptionFlags(): AdoptionFeatureFlags {
  return {
    harness: false,
    goals: false,
    qualityGates: false,
    durableTurns: false,
    wsGenerationReplay: true,
    sessionLease: false,
    subagentAdmission: false,
    interAgentMessaging: false,
    executableSkills: false,
    residentSessions: false,
  };
}

function mediumAdoptionFlags(
  base: AdoptionFeatureFlags,
  ctx: AdoptionTurnContext,
  lower: string,
): AdoptionFeatureFlags {
  const needsQualityGates =
    /\b(test|verify|validate|check|lint|build|deploy|ci|pr|review|audit|gate)\b/.test(lower);
  const needsSubagents =
    ctx.userText.trim().length > 120
    || /\b(research|analyze|investigate|parallel|subagent|delegate|crew)\b/.test(lower);
  const taskLike = !isInformationalUserQuery(ctx.userText);
  const profile = profileRequest(ctx.userText);

  // Consumer requests should be direct by default. Shopping, booking, travel,
  // and ordinary finance questions do not need goal loops, harness work, or
  // subagents unless the user clearly asks for comparison/planning/research.
  if (profile.isConsumerRequest) {
    const needsParallelResearch = profile.requiresMultiStep
      && /\b(research|compare|comparison|shortlist|multiple|several)\b/.test(lower);
    return {
      ...base,
      harness: false,
      goals: false,
      qualityGates: false,
      durableTurns: profile.requiresMultiStep,
      wsGenerationReplay: true,
      sessionLease: profile.requiresMultiStep,
      subagentAdmission: needsParallelResearch,
      interAgentMessaging: needsParallelResearch,
      executableSkills: false,
      residentSessions: false,
    };
  }

  return {
    ...base,
    harness: !ctx.goalContinuation && taskLike,
    goals: !ctx.goalContinuation && taskLike,
    qualityGates: needsQualityGates,
    durableTurns: true,
    wsGenerationReplay: true,
    sessionLease: true,
    subagentAdmission: needsSubagents,
    interAgentMessaging: needsSubagents,
    executableSkills: /\b(skill|script|package|install|run locally|executable)\b/.test(lower),
    residentSessions:
      !ctx.goalContinuation
      && /\b(background|continue later|keep running|long running|overnight|watch)\b/.test(lower),
  };
}

/**
 * Resolve adoption capabilities for the current turn from thinking/output mode and prompt.
 */
export function applyAdoptionTurnPolicy(ctx: AdoptionTurnContext): void {
  const thinking = ctx.thinkingMode ?? 'medium';
  const base = getAdoptionFeatureFlags();
  const text = ctx.userText.trim();
  const lower = text.toLowerCase();

  if (ctx.goalContinuation) {
    setAdoptionTurnOverrides({
      ...lightAdoptionFlags(),
      goals: thinking === 'high',
      harness: thinking === 'high',
      durableTurns: thinking !== 'light',
      sessionLease: thinking !== 'light',
    });
    return;
  }

  if (thinking === 'light') {
    setAdoptionTurnOverrides(lightAdoptionFlags());
    return;
  }

  if (thinking === 'medium') {
    setAdoptionTurnOverrides(mediumAdoptionFlags(base, ctx, lower));
    return;
  }

  const highProfile = profileRequest(text);
  if (highProfile.isConsumerRequest) {
    const needsParallelResearch = highProfile.requiresMultiStep
      && /\b(research|compare|comparison|shortlist|multiple|several)\b/.test(lower);
    setAdoptionTurnOverrides({
      ...base,
      harness: false,
      goals: false,
      qualityGates: false,
      durableTurns: highProfile.requiresMultiStep,
      wsGenerationReplay: true,
      sessionLease: highProfile.requiresMultiStep,
      subagentAdmission: needsParallelResearch,
      interAgentMessaging: needsParallelResearch,
      executableSkills: false,
      residentSessions: false,
    });
    return;
  }

  // high — full adoption surfaces available; turn logic still gates actual use
  const needsQualityGates =
    /\b(test|verify|validate|check|lint|build|deploy|ci|pr|review|audit|gate)\b/.test(lower);
  const needsSubagents =
    text.length > 120
    || /\b(research|analyze|investigate|parallel|subagent|delegate|crew)\b/.test(lower);
  const needsSkills = /\b(skill|script|package|install|run locally|executable)\b/.test(lower);
  const needsResident =
    /\b(background|continue later|keep running|long running|overnight|watch)\b/.test(lower);

  setAdoptionTurnOverrides({
    ...base,
    harness: true,
    goals: !isInformationalUserQuery(text),
    qualityGates: base.qualityGates || needsQualityGates,
    durableTurns: true,
    wsGenerationReplay: true,
    sessionLease: true,
    subagentAdmission: base.subagentAdmission || needsSubagents,
    interAgentMessaging: base.interAgentMessaging || needsSubagents,
    executableSkills: base.executableSkills || needsSkills,
    residentSessions: base.residentSessions || needsResident,
  });
}

export function clearAdoptionTurnPolicy(): void {
  setAdoptionTurnOverrides(null);
}
