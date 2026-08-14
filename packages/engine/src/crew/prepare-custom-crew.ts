import { randomUUID } from 'node:crypto';
import type { CrewCreateInput, CrewEmotion } from '@agentx/shared';
import {
  classifyTemplateSource,
  listCrewPersonaTemplates,
  PROMPT_WRITE_GUIDE,
  resolveTemplate,
  type CrewTemplateId,
  type TemplateSource,
} from './crew-persona-catalog.js';

export type BehaviourProfile = CrewTemplateId;

export interface CustomCrewDraft {
  brief: string;
  /** Template id or spoken name ("coach", "support template"). */
  template?: string;
  name?: string;
  title?: string;
  callsign?: string;
  description?: string;
  systemPrompt?: string;
  emotion?: string;
  expertise?: string[];
  traits?: string[];
  tags?: string[];
  tools?: string[];
}

export interface PreparedCustomCrew extends CrewCreateInput {
  profile: CrewTemplateId;
}

export interface PersonaDraftKit {
  templateId: CrewTemplateId;
  templateSource: TemplateSource;
  templateNamedByOwner: boolean;
  needTemplateChoice: boolean;
  label: string;
  tagline: string;
  contract: string;
  suggestedName: string;
  suggestedTitle: string;
  suggestedCallsign: string;
  suggestedDescription: string;
  suggestedEmotion: CrewEmotion;
  suggestedExpertise: string[];
  suggestedTraits: string[];
  availableTemplates: Array<{ id: string; label: string; tagline: string }>;
  promptOutline: string;
  writeInstructions: string;
}

export interface PromptValidation {
  ok: boolean;
  issues: string[];
}

const EMOTIONS: readonly CrewEmotion[] = [
  'professional', 'friendly', 'witty', 'kind', 'funny',
  'arrogant', 'flirty', 'happy', 'sad', 'sarcastic',
];

const COLORS = ['#5B8DEF', '#4ECDC4', '#9B7BFF', '#E8A838', '#3DCF8E', '#6EC1E4', '#F07167', '#C084FC'];

export const MIN_AGENT_SYSTEM_PROMPT_CHARS = 180;

export function toCallsign(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 32);
  return slug || 'crew';
}

export function uniqueCallsign(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((c) => c.toLowerCase()));
  const candidate = toCallsign(base);
  if (!used.has(candidate)) return candidate;
  for (let i = 2; i < 50; i++) {
    const next = `${candidate}_${i}`.slice(0, 36);
    if (!used.has(next)) return next;
  }
  return `${candidate}_${Date.now().toString(36).slice(-4)}`;
}

export function inferBehaviourProfile(text: string, explicitTemplate?: string): BehaviourProfile {
  return resolveTemplate(text, explicitTemplate).id;
}

function parseEmotion(value: string | undefined, fallback: CrewEmotion): CrewEmotion {
  const raw = (value ?? '').trim().toLowerCase();
  return (EMOTIONS as readonly string[]).includes(raw) ? raw as CrewEmotion : fallback;
}

function asStringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const t = item.trim();
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function inferTitle(brief: string, fallback: string): string {
  const cleaned = brief.replace(/\s+/g, ' ').trim();
  const patterns = [
    /(?:create|add|make|hire|need|want|build)\s+(?:a|an|me\s+a|me\s+an)\s+([^.,;]+)/i,
    /(?:crew|specialist|member)\s+(?:for|who)\s+([^.,;]+)/i,
  ];
  for (const re of patterns) {
    const m = cleaned.match(re);
    if (m?.[1]) {
      const title = m[1].replace(/\b(who|that|with|named|called)\b[\s\S]*$/i, '').trim();
      if (title.length >= 3 && title.length <= 60) return title.replace(/^\w/, (c) => c.toUpperCase());
    }
  }
  return fallback;
}

function inferName(brief: string, title: string): string {
  const named = brief.match(/(?:named|called|call (?:them|him|her|it))\s+["']?([A-Z][\w.]+(?:\s+[A-Z][\w.]+){0,2})/i);
  if (named?.[1]) return named[1].trim();
  return title;
}

function inferDomain(brief: string, title: string): string {
  const cleaned = brief.replace(/\s+/g, ' ').trim();
  if (cleaned.length >= 8 && cleaned.length <= 160) return cleaned;
  return title;
}

function mergeUnique(primary: string[], fallback: string[], max: number): string[] {
  const out: string[] = [];
  for (const item of [...primary, ...fallback]) {
    const t = item.trim();
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function fallbackSystemPrompt(input: {
  name: string;
  title: string;
  domain: string;
  contract: string;
  tagline: string;
  expertise: string[];
  emotion: CrewEmotion;
  brief: string;
}): string {
  const skills = input.expertise.map((s) => `- ${s}`).join('\n');
  return [
    `You are ${input.name}, ${input.title}.`,
    '',
    `Persona: ${input.tagline}`,
    `Owner request: ${input.brief.trim()}`,
    `Domain focus: ${input.domain}.`,
    '',
    input.contract,
    '',
    'Domain strengths:',
    skills || '- (defined by the owner brief)',
    '',
    `Communication style / tone: ${input.emotion}.`,
    'Sound specific. Reference what they just said. Stay in character unless they end the engagement.',
  ].join('\n');
}

/**
 * Turn a natural-language request (plus optional structured fields) into a
 * complete custom-crew spec. Prefers the agent's prepared fields; fills gaps
 * so the owner is not bounced to the UI.
 */
export function prepareCustomCrew(draft: CustomCrewDraft, takenCallsigns: Iterable<string> = []): PreparedCustomCrew {
  const brief = draft.brief.trim();
  if (!brief) {
    throw new Error('brief is required');
  }

  const template = resolveTemplate([brief, draft.title, draft.description].filter(Boolean).join(' '), draft.template);
  const profile = template.id;
  const title = (draft.title?.trim() || inferTitle(brief, template.label)).slice(0, 80);
  const name = (draft.name?.trim() || inferName(brief, title)).slice(0, 80);
  const domain = inferDomain(brief, title);
  const emotion = parseEmotion(draft.emotion, template.defaultTone);
  const expertise = mergeUnique(asStringList(draft.expertise, 12), template.baseExpertise, 10);
  const traits = mergeUnique(asStringList(draft.traits, 8), template.baseTraits, 6);
  const tags = mergeUnique(
    asStringList(draft.tags, 12),
    [...expertise.slice(0, 4), `template:${profile}`],
    10,
  );
  const providedPrompt = draft.systemPrompt?.trim() ?? '';
  const systemPrompt = providedPrompt.length >= MIN_AGENT_SYSTEM_PROMPT_CHARS
    ? providedPrompt
    : fallbackSystemPrompt({
      name, title, domain, contract: template.contract, tagline: template.tagline, expertise, emotion, brief,
    });
  const description = (draft.description?.trim() || `${title} — ${template.tagline}`).slice(0, 280);
  const callsign = uniqueCallsign(draft.callsign?.trim() || name || title, takenCallsigns);
  const tools = asStringList(draft.tools, 20);
  const color = COLORS[Math.abs(hashCode(callsign)) % COLORS.length];

  return {
    id: `custom-${randomUUID()}`,
    name,
    title,
    callsign,
    systemPrompt,
    description,
    emotion,
    source: 'custom',
    suggestable: true,
    isDefault: false,
    enabled: true,
    expertise,
    traits,
    tags,
    tools: tools.length ? tools : undefined,
    color,
    profile,
  };
}

function hashCode(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = ((h << 5) - h + value.charCodeAt(i)) | 0;
  return h;
}

function hasGenericAssistantVoice(prompt: string): boolean {
  return prompt.split('\n').some((line) => {
    const t = line.trim().toLowerCase();
    if (!t) return false;
    if (/^(no |never |forbidden|anti-|do not |don't )/.test(t)) return false;
    return /how can i help|what would you like to discuss|i'?m ready whenever you are/.test(t);
  });
}

export function isAdequateSystemPrompt(prompt: string | undefined): boolean {
  return validateAgentSystemPrompt(prompt).ok;
}

export function validateAgentSystemPrompt(prompt: string | undefined): PromptValidation {
  const p = (prompt ?? '').trim();
  const issues: string[] = [];
  if (p.length < MIN_AGENT_SYSTEM_PROMPT_CHARS) {
    issues.push(`systemPrompt must be at least ${MIN_AGENT_SYSTEM_PROMPT_CHARS} characters — you write it, do not omit it.`);
  }
  if (!/you are\s+\S+/i.test(p)) issues.push('Missing identity line ("You are {name}, {title}.").');
  if (!/binding role/i.test(p)) issues.push('Missing BINDING ROLE (who they are and who the user is).');
  if (!/hard constraint/i.test(p)) issues.push('Missing HARD CONSTRAINTS (domain-specific never/always rules).');
  if (hasGenericAssistantVoice(p)) {
    issues.push('Generic assistant voice is forbidden.');
  }
  return { ok: issues.length === 0, issues };
}

export function buildPersonaDraftKit(draft: CustomCrewDraft, takenCallsigns: Iterable<string> = []): PersonaDraftKit {
  const brief = draft.brief.trim();
  if (!brief) throw new Error('brief is required');
  const classified = classifyTemplateSource(brief, draft.template);
  const prepared = prepareCustomCrew(draft, takenCallsigns);
  const template = classified.template;
  return {
    templateId: template.id,
    templateSource: classified.source,
    templateNamedByOwner: classified.source === 'named' || classified.source === 'explicit',
    needTemplateChoice: classified.needTemplateChoice,
    label: template.label,
    tagline: template.tagline,
    contract: template.contract,
    suggestedName: prepared.name,
    suggestedTitle: prepared.title ?? template.label,
    suggestedCallsign: prepared.callsign,
    suggestedDescription: prepared.description ?? `${prepared.title} — ${template.tagline}`,
    suggestedEmotion: prepared.emotion ?? template.defaultTone,
    suggestedExpertise: prepared.expertise ?? [...template.baseExpertise],
    suggestedTraits: prepared.traits ?? [...template.baseTraits],
    availableTemplates: listCrewPersonaTemplates().map((t) => ({
      id: t.id,
      label: t.label,
      tagline: t.tagline,
    })),
    promptOutline: [
      `You are ${prepared.name}, ${prepared.title}.`,
      `BINDING ROLE: (write from the ${template.id} contract — who they are, who the user is)`,
      'ANTI-ASSISTANT RULE: (forbidden generic-helper openers; role beats helpfulness)',
      `HARD CONSTRAINTS: (3–6 rules from this brief: ${brief.slice(0, 220)})`,
      `METHOD / FLOW: (how a ${template.label} session starts and proceeds)`,
      `Tone: ${prepared.emotion ?? template.defaultTone}. Stay in character.`,
    ].join('\n'),
    writeInstructions: PROMPT_WRITE_GUIDE,
  };
}

export function formatPromptRequiredOutput(kit: PersonaDraftKit): string {
  const choice = kit.needTemplateChoice
    ? [
      'The owner asked for a template but did not name one. Call crew_list_templates, pick the best fit (or ask once), then write the prompt.',
      '',
    ]
    : [];
  return [
    'PROMPT_REQUIRED — you must write systemPrompt yourself, then call crew_create_custom again.',
    `Resolved template: ${kit.templateId} (${kit.label}) · source: ${kit.templateSource}${kit.templateNamedByOwner ? ' · owner-named' : ''}.`,
    ...choice,
    '',
    `Suggested identity: ${kit.suggestedName} — ${kit.suggestedTitle} (@${kit.suggestedCallsign})`,
    `Tone: ${kit.suggestedEmotion}`,
    `Skills: ${kit.suggestedExpertise.join(', ') || '(invent from the brief)'}`,
    `Traits: ${kit.suggestedTraits.join(', ') || '(invent from the brief)'}`,
    '',
    'Behaviour contract (law for YOUR prompt — do not paste unchanged):',
    kit.contract,
    '',
    'Outline to expand (rewrite, do not submit this outline as the prompt):',
    kit.promptOutline,
    '',
    kit.writeInstructions,
  ].join('\n');
}
