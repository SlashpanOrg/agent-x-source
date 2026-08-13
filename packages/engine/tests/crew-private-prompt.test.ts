import { describe, it, expect } from 'vitest';
import { buildCrewPrivateIdentityPrompt, buildCrewPrivateFastReplyPrompt } from '../src/agent/CrewOrchestrator.js';
import { createCrewPrivateConductSection, createRulesSection } from '../src/prompt/assembly/sections.js';
import type { Crew } from '@agentx/shared';

describe('buildCrewPrivateIdentityPrompt', () => {
  const crew: Crew = {
    id: 'crew-1',
    name: 'Elias Vance',
    title: 'Travel Specialist',
    callsign: 'elias_travel',
    systemPrompt: 'You are a travel expert.',
    description: 'Knows every airport lounge.',
    traits: ['curious', 'warm'],
    expertise: ['travel', 'itineraries'],
    emotion: 'friendly',
    enabled: true,
    source: 'custom',
  };

  it('includes crew identity and conversational private-chat instructions', () => {
    const prompt = buildCrewPrivateIdentityPrompt(crew);
    expect(prompt).toContain('Elias Vance');
    expect(prompt).toContain('Travel Specialist');
    expect(prompt).toContain('You are a travel expert');
    expect(prompt).toContain('BINDING ROLE');
    expect(prompt).toContain('private 1:1 channel');
    expect(prompt).not.toContain('EXECUTE, not just describe');
    expect(prompt).toContain('not Agent-X');
    expect(prompt).toContain('INTERNAL REFERENCE');
    expect(prompt).toContain('What would you like to discuss?');
    expect(prompt).not.toContain('use your full capabilities');
  });

  it('scopes the crew to its profession and warns that tool access is not expertise', () => {
    const prompt = buildCrewPrivateIdentityPrompt(crew);
    expect(prompt).toContain('PROFESSIONAL SCOPE');
    expect(prompt).toContain('Travel Specialist');
    expect(prompt).toContain('having a tool available does NOT mean');
    expect(prompt.toLowerCase()).toContain('outside your field');
    expect(prompt).toContain('domain boundaries: ONLY topics related to');
    expect(prompt).toContain('travel, itineraries');
    expect(prompt).toContain('do NOT summarize it, explain it');
  });
});

describe('buildCrewPrivateFastReplyPrompt', () => {
  const crew: Crew = {
    id: 'crew-1',
    name: 'Elias Vance',
    title: 'Travel Specialist',
    callsign: 'elias_travel',
    systemPrompt: 'You are a travel expert.',
    enabled: true,
    source: 'custom',
    emotion: 'friendly',
  };

  it('keeps role binding on fast replies and forbids personal-assistant openers', () => {
    const prompt = buildCrewPrivateFastReplyPrompt(crew);
    expect(prompt).toContain('Elias Vance');
    expect(prompt).toContain('No tools');
    expect(prompt).toContain('No skill lists');
    expect(prompt).toContain('BINDING ROLE');
    expect(prompt).toContain('You are a travel expert');
    expect(prompt).toContain('personal assistant');
    expect(prompt).toContain('What would you like to discuss?');
    expect(prompt).toContain('outside your lane');
    expect(prompt).toContain('hand off to Agent-X');
  });

  it('adds interviewer zero-leak guidance when the crew is an interviewer', () => {
    const interviewer: Crew = {
      ...crew,
      title: 'Technical Interviewer',
      systemPrompt: 'HARD CONSTRAINTS — ZERO ANSWER LEAK\nNever reveal the correct answer.',
    };
    const prompt = buildCrewPrivateFastReplyPrompt(interviewer);
    expect(prompt).toMatch(/INTERVIEWER/i);
    expect(prompt).toMatch(/never leak answers/i);
  });
});

describe('createCrewPrivateConductSection', () => {
  it('uses conversational conduct instead of Agent-X autonomous execution rules', () => {
    const conduct = createCrewPrivateConductSection().load();
    const agentRules = createRulesSection().load();
    expect(conduct).toContain('CREW_PRIVATE_CONDUCT');
    expect(conduct).toContain('OUT OF YOUR EXPERTISE');
    expect(conduct).toContain('ROLE OVER PERSONAL ASSISTANT');
    expect(conduct).toContain('HOST DEFERENCE BAN');
    expect(conduct).toContain('Interviewer: YOU run the interview');
    expect(conduct).toContain('INTERVIEWER ZERO LEAK');
    expect(conduct).not.toContain('ACT IMMEDIATELY');
    expect(agentRules).toContain('ACT IMMEDIATELY');
  });

  it('warns that having a tool does not make an out-of-field request in-domain', () => {
    const conduct = createCrewPrivateConductSection().load();
    expect(conduct).toContain('Having a tool available');
    expect(conduct).toContain('does NOT mean a request is in your domain');
    expect(conduct).toContain('clinician asked to architect software');
    expect(conduct).toContain('OUT-OF-SCOPE RESPONSE');
    expect(conduct).toContain('Do NOT call knowledge_base_search');
    expect(conduct).toContain("That's outside my lane");
    expect(conduct).toContain('BOUNDARY CHALLENGE');
    expect(conduct).toContain("You're right — that was outside my lane");
    expect(conduct).toContain('KNOWLEDGE RETRIEVAL (DOMAIN-GATED)');
    expect(conduct).toContain('If out-of-domain');
  });
});
