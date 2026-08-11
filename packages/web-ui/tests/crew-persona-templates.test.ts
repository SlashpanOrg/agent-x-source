import { describe, expect, it } from 'vitest';
import {
  CREW_PERSONA_TEMPLATES,
  buildCrewPersonaFromTemplate,
  getCrewPersonaTemplate,
} from '../src/components/crew/crew-persona-templates';

describe('crew-persona-templates', () => {
  it('includes support, interviewer, friend, and custom', () => {
    const ids = CREW_PERSONA_TEMPLATES.map((t) => t.id);
    expect(ids).toContain('support');
    expect(ids).toContain('interviewer');
    expect(ids).toContain('friend');
    expect(ids).toContain('custom');
    expect(CREW_PERSONA_TEMPLATES.length).toBeGreaterThanOrEqual(8);
  });

  it('builds a locked support persona from domain + identity', () => {
    const template = getCrewPersonaTemplate('support')!;
    const built = buildCrewPersonaFromTemplate(template, {
      name: 'Maya Chen',
      title: 'Support Lead',
      callsign: 'maya_support',
      domain: 'B2B SaaS',
    });
    expect(built.description).toMatch(/B2B SaaS/i);
    expect(built.tone).toBe('professional');
    expect(built.systemPrompt).toContain('Maya Chen');
    expect(built.systemPrompt).toMatch(/support agent/i);
    expect(built.systemPrompt).toMatch(/NOT a generic personal assistant/i);
    expect(built.expertise.length).toBeGreaterThan(0);
    expect(built.traits).toContain('patient');
  });

  it('builds an interviewer who drives questions instead of PA openers', () => {
    const template = getCrewPersonaTemplate('interviewer')!;
    const built = buildCrewPersonaFromTemplate(template, {
      name: 'Austin Jaison',
      title: 'Technical Interviewer',
      callsign: 'austin_interview',
      domain: 'Software engineering',
    });
    expect(built.systemPrompt).toContain('Austin Jaison');
    expect(built.systemPrompt).toMatch(/ZERO ANSWER LEAK/i);
    expect(built.systemPrompt).toMatch(/NEVER reveal the correct answer/i);
    expect(built.systemPrompt).toMatch(/you tell me/i);
    expect(built.systemPrompt).toMatch(/keywords/i);
    expect(built.systemPrompt).toMatch(/What would you like to discuss/i);
    expect(built.systemPrompt).toMatch(/first real domain interview question/i);
  });

  it('gives each non-custom template hard constraints for real-life behaviour', () => {
    for (const template of CREW_PERSONA_TEMPLATES) {
      if (template.id === 'custom') continue;
      const built = buildCrewPersonaFromTemplate(template, {
        name: 'Test User',
        title: template.label,
        callsign: 'test_user',
        domain: 'General',
      });
      expect(built.systemPrompt).toMatch(/HARD CONSTRAINTS/i);
      expect(built.systemPrompt).toMatch(/NOT a generic personal assistant/i);
      expect(built.systemPrompt.length).toBeGreaterThan(400);
    }
  });

  it('custom template returns empty editable fields', () => {
    const template = getCrewPersonaTemplate('custom')!;
    const built = buildCrewPersonaFromTemplate(template, {
      name: 'Alex',
      title: 'Whatever',
      callsign: 'alex',
      domain: 'Anything',
    });
    expect(built.systemPrompt).toBe('');
    expect(built.expertise).toEqual([]);
  });
});
