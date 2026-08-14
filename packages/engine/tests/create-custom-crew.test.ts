import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '../src/agent/Agent.js';
import type { Crew, CrewCreateInput } from '@agentx/shared';
import {
  classifyTemplateSource,
  resolveNamedTemplate,
} from '../src/crew/crew-persona-catalog.js';
import {
  buildPersonaDraftKit,
  inferBehaviourProfile,
  prepareCustomCrew,
  uniqueCallsign,
  validateAgentSystemPrompt,
} from '../src/crew/prepare-custom-crew.js';
import { createCustomCrew, setCustomCrewCreateAgent } from '../src/tools/builtin/create-custom-crew.js';
import {
  draftCrewPersona,
  getCrewTemplate,
  listCrewRoster,
  listCrewTemplates,
  resolveCrewTemplate,
  validateCrewPrompt,
} from '../src/tools/builtin/crew-awareness-tools.js';

function ctx() {
  return { sessionId: 's1', contextKind: 'group' as const };
}

const AGENT_PROMPT = [
  'You are Mira, Tax Counsel for Indian GST and international structuring.',
  'BINDING ROLE: You are counsel. The user is the founder asking for a tax read.',
  'ANTI-ASSISTANT RULE: No "how can I help" openers. Stay counsel.',
  'HARD CONSTRAINTS: Never invent statute citations. Flag when they need a licensed CA.',
  'METHOD: Restate the fact pattern, isolate the issue, give options with risk, then a recommended next filing step.',
  'Tone: professional, precise, calm.',
].join('\n');

describe('prepareCustomCrew', () => {
  it('infers a coach profile and fills a complete spec from a brief', () => {
    const spec = prepareCustomCrew({
      brief: 'Create a career coach who is direct and keeps me accountable on leadership habits',
    });
    expect(spec.profile).toBe('coach');
    expect(spec.source).toBe('custom');
    expect(spec.enabled).toBe(true);
    expect(spec.name.length).toBeGreaterThan(2);
    expect(spec.callsign).not.toMatch(/\s/);
    expect(spec.systemPrompt.length).toBeGreaterThan(180);
    expect(spec.expertise!.length).toBeGreaterThanOrEqual(4);
    expect(spec.traits!.length).toBeGreaterThanOrEqual(3);
    expect(spec.systemPrompt).toContain('career coach');
  });

  it('keeps a deeply prepared system prompt from the agent', () => {
    const prompt = [
      'You are Mira, Tax Counsel for Indian GST and international structuring.',
      'BINDING ROLE: You are counsel, not a bookkeeper or a generic assistant.',
      'HARD CONSTRAINTS: Never invent statute citations. Flag when the owner needs a licensed CA.',
      'METHOD: Restate the fact pattern, isolate the issue, give options with risk, then a recommended next filing step.',
      'Tone: professional, precise, calm.',
    ].join('\n');
    const spec = prepareCustomCrew({
      brief: 'Need a tax counsel for GST',
      name: 'Mira',
      title: 'Tax Counsel',
      callsign: 'mira_tax',
      systemPrompt: prompt,
      expertise: ['GST', 'Transfer pricing', 'Withholding'],
      traits: ['precise', 'cautious'],
      emotion: 'professional',
    });
    expect(spec.name).toBe('Mira');
    expect(spec.callsign).toBe('mira_tax');
    expect(spec.systemPrompt).toBe(prompt);
    expect(spec.expertise).toContain('GST');
  });

  it('does not collide with an existing callsign', () => {
    expect(uniqueCallsign('mira_tax', ['mira_tax'])).toBe('mira_tax_2');
  });

  it('infers interviewer vs researcher from the brief', () => {
    expect(inferBehaviourProfile('run a tough coding interview')).toBe('interviewer');
    expect(inferBehaviourProfile('evidence-first market research brief')).toBe('researcher');
  });

  it('honors a named template over keyword inference', () => {
    const spec = prepareCustomCrew({
      brief: 'Create a market research analyst using the coach template for fundraising practice',
      template: 'coach',
      systemPrompt: AGENT_PROMPT,
    });
    expect(spec.profile).toBe('coach');
    expect(spec.systemPrompt).toBe(AGENT_PROMPT);
  });

  it('treats no-template as custom even when role keywords exist', () => {
    expect(resolveNamedTemplate('career coach but no template please')).toBeDefined();
    expect(resolveNamedTemplate('career coach but no template please')?.id).toBe('custom');
    expect(inferBehaviourProfile('career coach but no template please')).toBe('custom');
  });
});

describe('template resolution', () => {
  it('resolves spoken template names', () => {
    expect(resolveNamedTemplate('use the coach template')?.id).toBe('coach');
    expect(resolveNamedTemplate('project manager template')?.id).toBe('project_manager');
    expect(resolveNamedTemplate('from scratch')?.id).toBe('custom');
  });

  it('flags an unnamed template request', () => {
    const hit = classifyTemplateSource('create someone, I want a template');
    expect(hit.needTemplateChoice).toBe(true);
    expect(hit.template.id).toBe('custom');
  });
});

describe('persona draft kit and prompt validation', () => {
  it('builds a kit the agent can write from', () => {
    const kit = buildPersonaDraftKit({
      brief: 'Create a career coach using the coach template',
    });
    expect(kit.templateId).toBe('coach');
    expect(kit.templateNamedByOwner).toBe(true);
    expect(kit.contract).toContain('PERFORMANCE COACH');
    expect(kit.writeInstructions).toContain('YOU write the systemPrompt');
    expect(kit.suggestedCallsign).not.toMatch(/\s/);
  });

  it('rejects a missing or generic prompt', () => {
    expect(validateAgentSystemPrompt(undefined).ok).toBe(false);
    expect(validateAgentSystemPrompt('You are helpful. How can I help you today?').ok).toBe(false);
    expect(validateAgentSystemPrompt(AGENT_PROMPT).ok).toBe(true);
  });
});

describe('createCustomCrew tool', () => {
  afterEach(() => setCustomCrewCreateAgent(null));

  it('requires a brief', async () => {
    const result = await createCustomCrew({}, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toBe('MISSING_INPUT');
  });

  it('creates, persists, and enables the crew on the live agent', async () => {
    const created: Crew[] = [];
    const addCrewMember = vi.fn();
    const setCrewEnabled = vi.fn();
    const fake = {
      crew: {
        list: () => created,
        create: (input: CrewCreateInput) => {
          const crew = { ...input, createdAt: 't', updatedAt: 't' } as Crew;
          created.push(crew);
          return crew;
        },
        flushPersist: vi.fn(async () => {}),
      },
      addCrewMember,
      setCrewEnabled,
    };
    setCustomCrewCreateAgent(fake as unknown as Agent);

    const result = await createCustomCrew({
      brief: 'Create a witty sounding board for product decisions',
      template: 'sounding_board',
      name: 'Reed',
      title: 'Product Sounding Board',
      systemPrompt: [
        'You are Reed, Product Sounding Board.',
        'BINDING ROLE: You are a trusted sounding board. The user owns the decision.',
        'HARD CONSTRAINTS: Reflect then stress-test. Do not take the decision. No generic assistant voice.',
        'METHOD: Reflect accurately, challenge assumptions, offer 2–3 options with trade-offs, then a recommendation.',
        'Tone: witty, loyal, incisive.',
      ].join('\n'),
    }, ctx());

    expect(result.success).toBe(true);
    expect(result.output).toContain('@reed');
    expect(result.output).toContain('sounding_board');
    expect(created).toHaveLength(1);
    expect(created[0]?.source).toBe('custom');
    expect(created[0]?.title).toBe('Product Sounding Board');
    expect(addCrewMember).toHaveBeenCalledOnce();
    expect(setCrewEnabled).toHaveBeenCalledWith(created[0]?.id, true);
    expect(fake.crew.flushPersist).toHaveBeenCalledOnce();
  });

  it('refuses to persist without an agent-written system prompt', async () => {
    const created: Crew[] = [];
    setCustomCrewCreateAgent({
      crew: {
        list: () => created,
        create: () => { throw new Error('should not create'); },
        flushPersist: vi.fn(async () => {}),
      },
      addCrewMember: vi.fn(),
      setCrewEnabled: vi.fn(),
    } as unknown as Agent);

    const result = await createCustomCrew({
      brief: 'Create a career coach using the coach template',
    }, ctx());

    expect(result.success).toBe(false);
    expect(result.error).toBe('PROMPT_REQUIRED');
    expect(result.output).toContain('YOU write the systemPrompt');
    expect(result.output).toContain('coach');
    expect(created).toHaveLength(0);
  });

  it('accepts system_prompt alias', async () => {
    const created: Crew[] = [];
    setCustomCrewCreateAgent({
      crew: {
        list: () => created,
        create: (input: CrewCreateInput) => {
          const crew = { ...input, createdAt: 't', updatedAt: 't' } as Crew;
          created.push(crew);
          return crew;
        },
        flushPersist: vi.fn(async () => {}),
      },
      addCrewMember: vi.fn(),
      setCrewEnabled: vi.fn(),
    } as unknown as Agent);

    const result = await createCustomCrew({
      brief: 'Create a medical writing interviewer',
      system_prompt: AGENT_PROMPT,
    }, ctx());
    expect(result.success).toBe(true);
    expect(created).toHaveLength(1);
  });

  it('fills the prompt from the template on a voice session', async () => {
    const created: Crew[] = [];
    setCustomCrewCreateAgent({
      crew: {
        list: () => created,
        create: (input: CrewCreateInput) => {
          const crew = { ...input, createdAt: 't', updatedAt: 't' } as Crew;
          created.push(crew);
          return crew;
        },
        flushPersist: vi.fn(async () => {}),
      },
      addCrewMember: vi.fn(),
      setCrewEnabled: vi.fn(),
    } as unknown as Agent);

    const result = await createCustomCrew({
      brief: 'Create a crew member who is an interviewer for medical writing in pharmaceutical industries',
      template: 'interviewer',
      name: 'MedWrite',
    }, { sessionId: '__channel__:voice', contextKind: 'group' as const, voiceTurn: true });

    expect(result.success).toBe(true);
    expect(result.output).toContain('@medwrite');
    expect(created).toHaveLength(1);
    expect(created[0]?.systemPrompt).toContain('BINDING ROLE');
    expect(created[0]?.systemPrompt).toContain('HARD CONSTRAINT');
  });

  it('replaces a weak prompt from the template on voice', async () => {
    const created: Crew[] = [];
    setCustomCrewCreateAgent({
      crew: {
        list: () => created,
        create: (input: CrewCreateInput) => {
          const crew = { ...input, createdAt: 't', updatedAt: 't' } as Crew;
          created.push(crew);
          return crew;
        },
        flushPersist: vi.fn(async () => {}),
      },
      addCrewMember: vi.fn(),
      setCrewEnabled: vi.fn(),
    } as unknown as Agent);

    const result = await createCustomCrew({
      brief: 'Create an interviewer for medical writing in pharma',
      template: 'interviewer',
      name: 'MedWrite',
      systemPrompt: 'You are a helpful assistant.',
    }, { sessionId: 'ws-voice-1', contextKind: 'group' as const, voiceTurn: true });

    expect(result.success).toBe(true);
    expect(created[0]?.systemPrompt).toContain('BINDING ROLE');
    expect(created[0]?.systemPrompt).not.toContain('helpful assistant');
  });
});

describe('crew awareness tools', () => {
  afterEach(() => setCustomCrewCreateAgent(null));

  it('lists every template id', async () => {
    const result = await listCrewTemplates({}, ctx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('coach');
    expect(result.output).toContain('sounding_board');
    expect((result.metadata as { templates: unknown[] }).templates).toHaveLength(11);
  });

  it('returns a full contract for a spoken template name', async () => {
    const result = await getCrewTemplate({ template: 'coach' }, ctx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('PERFORMANCE COACH');
    expect(result.output).toContain('YOU write the systemPrompt');
  });

  it('resolves a named template from owner speech', async () => {
    const result = await resolveCrewTemplate({
      text: 'Make me a crew, use the interviewer template for backend hiring',
    }, ctx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('interviewer');
    expect(result.output).toContain('named');
  });

  it('drafts a persona kit without persisting', async () => {
    setCustomCrewCreateAgent({
      crew: { list: () => [{ callsign: 'mira' }] },
    } as unknown as Agent);
    const result = await draftCrewPersona({
      brief: 'Create a career coach named Mira using the coach template',
    }, ctx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('PROMPT_REQUIRED');
    expect((result.metadata as { suggestedCallsign: string }).suggestedCallsign).not.toBe('mira');
  });

  it('validates an agent-written prompt', async () => {
    const bad = await validateCrewPrompt({ systemPrompt: 'be helpful' }, ctx());
    expect(bad.success).toBe(false);
    expect(bad.error).toBe('PROMPT_INVALID');
    const good = await validateCrewPrompt({ systemPrompt: AGENT_PROMPT }, ctx());
    expect(good.success).toBe(true);
  });

  it('lists the live roster', async () => {
    setCustomCrewCreateAgent({
      crew: {
        list: () => [{
          id: 'c1', name: 'Reed', title: 'Sounding Board', callsign: 'reed', enabled: true, source: 'custom',
        }],
      },
    } as unknown as Agent);
    const result = await listCrewRoster({}, ctx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('@reed');
  });
});
