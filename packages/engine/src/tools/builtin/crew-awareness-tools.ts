import type { ToolExecutionContext, ToolResult } from '@agentx/shared';
import {
  classifyTemplateSource,
  formatTemplateDetail,
  formatTemplateSummary,
  getCrewPersonaTemplate,
  listCrewPersonaTemplates,
  resolveNamedTemplate,
} from '../../crew/crew-persona-catalog.js';
import {
  buildPersonaDraftKit,
  formatPromptRequiredOutput,
  validateAgentSystemPrompt,
} from '../../crew/prepare-custom-crew.js';
import { getCustomCrewCreateAgent } from './create-custom-crew.js';

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringList(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];
  if (Array.isArray(value)) {
    const items = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim());
    return items.length ? items : undefined;
  }
  if (typeof value === 'string' && value.trim()) {
    const items = value.split(',').map((s) => s.trim()).filter(Boolean);
    return items.length ? items : undefined;
  }
  return undefined;
}

/** Catalog of persona templates the owner can name in chat or voice. */
export async function listCrewTemplates(
  _args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  const templates = listCrewPersonaTemplates();
  const lines = [
    'Crew persona templates (same ids as the Crews UI). Honor a named template. Use custom / no-template when they refuse one.',
    'You write the system prompt. These cards are law for that prompt — not the prompt itself.',
    '',
    ...templates.map(formatTemplateSummary),
  ];
  return {
    success: true,
    output: lines.join('\n'),
    metadata: {
      templates: templates.map((t) => ({
        id: t.id,
        label: t.label,
        tagline: t.tagline,
        blurb: t.blurb,
        defaultTone: t.defaultTone,
        aliases: t.aliases,
      })),
    },
  };
}

/** Full behaviour contract for one template so the agent can write the prompt. */
export async function getCrewTemplate(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  const raw = stringArg(args, 'template') ?? stringArg(args, 'id');
  if (!raw) {
    return {
      success: false,
      output: 'template is required (id, label, or spoken name such as "coach" or "project manager").',
      error: 'MISSING_INPUT',
    };
  }
  const template = getCrewPersonaTemplate(raw) ?? resolveNamedTemplate(raw);
  if (!template) {
    return {
      success: false,
      output: `Unknown template "${raw}". Call crew_list_templates. Valid ids: ${listCrewPersonaTemplates().map((t) => t.id).join(', ')}.`,
      error: 'UNKNOWN_TEMPLATE',
    };
  }
  return {
    success: true,
    output: formatTemplateDetail(template),
    metadata: {
      id: template.id,
      label: template.label,
      defaultTone: template.defaultTone,
      baseExpertise: template.baseExpertise,
      baseTraits: template.baseTraits,
      suggestedDomains: template.suggestedDomains,
    },
  };
}

/** Resolve whether the owner named a template, inferred one, or wants a blank slate. */
export async function resolveCrewTemplate(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  const text = stringArg(args, 'text') ?? stringArg(args, 'brief');
  if (!text) {
    return {
      success: false,
      output: 'text is required — the owner utterance or brief to scan for a template.',
      error: 'MISSING_INPUT',
    };
  }
  const classified = classifyTemplateSource(text, stringArg(args, 'template'));
  const t = classified.template;
  const lines = [
    `template: ${t.id} (${t.label})`,
    `source: ${classified.source}`,
    classified.needTemplateChoice
      ? 'needTemplateChoice: true — they asked for a template but did not name one. List options or infer from the role.'
      : 'needTemplateChoice: false',
    `tagline: ${t.tagline}`,
    `tone: ${t.defaultTone}`,
    'Next: crew_get_template or crew_draft_persona, then YOU write systemPrompt, then crew_create_custom.',
  ];
  return {
    success: true,
    output: lines.join('\n'),
    metadata: {
      templateId: t.id,
      source: classified.source,
      needTemplateChoice: classified.needTemplateChoice,
      label: t.label,
    },
  };
}

/** Identity + contract + outline. The agent still writes the real system prompt. */
export async function draftCrewPersona(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  const brief = stringArg(args, 'brief');
  if (!brief) {
    return {
      success: false,
      output: 'brief is required — the owner\'s natural-language request.',
      error: 'MISSING_INPUT',
    };
  }

  const agent = getCustomCrewCreateAgent();
  const taken = agent?.crew.list().map((c) => c.callsign) ?? [];
  try {
    const kit = buildPersonaDraftKit({
      brief,
      template: stringArg(args, 'template'),
      name: stringArg(args, 'name'),
      title: stringArg(args, 'title'),
      callsign: stringArg(args, 'callsign'),
      description: stringArg(args, 'description'),
      emotion: stringArg(args, 'emotion'),
      expertise: stringList(args, 'expertise'),
      traits: stringList(args, 'traits'),
    }, taken);
    return {
      success: true,
      output: formatPromptRequiredOutput(kit),
      metadata: { ...kit, next: 'Write systemPrompt yourself, optionally crew_validate_prompt, then crew_create_custom.' },
    };
  } catch (err) {
    return {
      success: false,
      output: err instanceof Error ? err.message : 'Failed to draft persona',
      error: 'DRAFT_FAILED',
    };
  }
}

/** Check the agent-written prompt before create. */
export async function validateCrewPrompt(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  const prompt = stringArg(args, 'systemPrompt') ?? stringArg(args, 'prompt');
  const result = validateAgentSystemPrompt(prompt);
  if (result.ok) {
    return {
      success: true,
      output: 'systemPrompt is adequate. Call crew_create_custom with this prompt plus brief (and template if the owner named one).',
      metadata: { ok: true, issues: [] },
    };
  }
  return {
    success: false,
    output: ['PROMPT_INVALID — fix these, then retry:', ...result.issues.map((i) => `- ${i}`)].join('\n'),
    error: 'PROMPT_INVALID',
    metadata: { ok: false, issues: result.issues },
  };
}

/** Existing roster so the agent avoids callsign collisions and duplicate roles. */
export async function listCrewRoster(
  _args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  const agent = getCustomCrewCreateAgent();
  if (!agent) {
    return {
      success: false,
      output: 'Crew roster is not available in this session.',
      error: 'NOT_CONFIGURED',
    };
  }
  const crews = agent.crew.list();
  if (crews.length === 0) {
    return {
      success: true,
      output: 'Roster is empty. Any callsign is free.',
      metadata: { count: 0, crews: [] },
    };
  }
  const lines = [
    `Roster (${crews.length}):`,
    ...crews.map((c) => {
      const bits = [
        `@${c.callsign}`,
        c.name,
        c.title ? `— ${c.title}` : '',
        c.enabled === false ? '(disabled)' : '',
        c.source ? `[${c.source}]` : '',
      ].filter(Boolean);
      return `- ${bits.join(' ')}`;
    }),
  ];
  return {
    success: true,
    output: lines.join('\n'),
    metadata: {
      count: crews.length,
      crews: crews.map((c) => ({
        id: c.id,
        name: c.name,
        title: c.title,
        callsign: c.callsign,
        enabled: c.enabled,
        source: c.source,
      })),
    },
  };
}
