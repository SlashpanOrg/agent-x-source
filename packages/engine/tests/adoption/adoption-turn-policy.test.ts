import { describe, it, expect, beforeEach } from 'vitest';
import {
  configureAdoptionFromConfig,
  getAdoptionFeatureFlags,
  setAdoptionTurnOverrides,
} from '@agentx/shared';
import {
  extractGoalObjectiveFromUserText,
  isInformationalUserQuery,
} from '../../src/goal/goal-from-prompt.js';
import { applyAdoptionTurnPolicy } from '../../src/adoption/adoption-turn-policy.js';

describe('goal-from-prompt', () => {
  it('extracts substantive objectives and skips greetings', () => {
    expect(extractGoalObjectiveFromUserText('hi')).toBeNull();
    expect(extractGoalObjectiveFromUserText('Build a REST API for inventory')).toBe(
      'Build a REST API for inventory',
    );
  });

  it('classifies informational queries', () => {
    expect(isInformationalUserQuery('Tell me about Voyager-1 and its recent findings.')).toBe(true);
    expect(isInformationalUserQuery('Build a deploy pipeline for staging')).toBe(false);
  });
});

describe('adoption-turn-policy', () => {
  beforeEach(() => {
    configureAdoptionFromConfig(null);
    setAdoptionTurnOverrides(null);
  });

  it('disables heavy adoption on light thinking mode', () => {
    applyAdoptionTurnPolicy({
      sessionId: 's1',
      userText: 'Summarize this document for me',
      thinkingMode: 'light',
      outputMode: 'brief',
    });
    const flags = getAdoptionFeatureFlags();
    expect(flags.harness).toBe(false);
    expect(flags.goals).toBe(false);
    expect(flags.durableTurns).toBe(false);
    expect(flags.wsGenerationReplay).toBe(true);
  });

  it('enables quality gates on medium when user asks to verify', () => {
    applyAdoptionTurnPolicy({
      sessionId: 's1',
      userText: 'Please run tests and verify the build',
      thinkingMode: 'medium',
      outputMode: 'moderate',
    });
    expect(getAdoptionFeatureFlags().qualityGates).toBe(true);
  });

  it('skips goals for informational medium-mode questions', () => {
    applyAdoptionTurnPolicy({
      sessionId: 's1',
      userText: 'Tell me about Voyager-1',
      thinkingMode: 'medium',
      outputMode: 'moderate',
    });
    expect(getAdoptionFeatureFlags().goals).toBe(false);
  });

  it('keeps ordinary shopping turns direct without adoption loops', () => {
    applyAdoptionTurnPolicy({
      sessionId: 's1',
      userText: 'Find me a quiet cordless vacuum under $250',
      thinkingMode: 'medium',
      outputMode: 'moderate',
    });
    const flags = getAdoptionFeatureFlags();
    expect(flags.harness).toBe(false);
    expect(flags.goals).toBe(false);
    expect(flags.subagentAdmission).toBe(false);
    expect(flags.durableTurns).toBe(false);
  });

  it('keeps complex travel comparisons durable but bounded', () => {
    applyAdoptionTurnPolicy({
      sessionId: 's1',
      userText: 'Research and compare several family vacation itineraries for Japan',
      thinkingMode: 'high',
      outputMode: 'detailed',
    });
    const flags = getAdoptionFeatureFlags();
    expect(flags.goals).toBe(false);
    expect(flags.durableTurns).toBe(true);
    expect(flags.subagentAdmission).toBe(true);
  });
});
