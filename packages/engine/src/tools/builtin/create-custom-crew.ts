import type { ToolExecutionContext, ToolResult } from '@agentx/shared';
import { isCrewVoiceSessionId } from '@agentx/shared';
import type { Agent } from '../../agent/Agent.js';
import {
  buildPersonaDraftKit,
  formatPromptRequiredOutput,
  isAdequateSystemPrompt,
  prepareCustomCrew,
  type CustomCrewDraft,
} from '../../crew/prepare-custom-crew.js';

let agentInstance: Agent | null = null;

export function setCustomCrewCreateAgent(agent: Agent | null): void {
  agentInstance = agent;
}

export function getCustomCrewCreateAgent(): Agent | null {
  return agentInstance;
}

function stringArg(args: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

const VOICE_SESSION_ID = '__channel__:voice';

function isVoiceSurface(context: ToolExecutionContext): boolean {
  return Boolean(context.voiceTurn)
    || context.sessionId === VOICE_SESSION_ID
    || isCrewVoiceSessionId(context.sessionId);
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

export async function createCustomCrew(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const brief = stringArg(args, 'brief');
  if (!brief) {
    return {
      success: false,
      output: 'brief is required — the owner\'s natural-language request for this crew.',
      error: 'MISSING_INPUT',
    };
  }

  if (!agentInstance) {
    return {
      success: false,
      output: 'Crew roster is not available in this session.',
      error: 'NOT_CONFIGURED',
    };
  }

  const draft: CustomCrewDraft = {
    brief,
    template: stringArg(args, 'template'),
    name: stringArg(args, 'name'),
    title: stringArg(args, 'title'),
    callsign: stringArg(args, 'callsign'),
    description: stringArg(args, 'description'),
    systemPrompt: stringArg(args, 'systemPrompt', 'system_prompt', 'prompt'),
    emotion: stringArg(args, 'emotion'),
    expertise: stringList(args, 'expertise'),
    traits: stringList(args, 'traits'),
    tags: stringList(args, 'tags'),
    tools: stringList(args, 'tools'),
  };

  try {
    const mgr = agentInstance.crew;
    const taken = mgr.list().map((c) => c.callsign);
    if (!isAdequateSystemPrompt(draft.systemPrompt)) {
      // Voice function-calls often drop or truncate the long systemPrompt JSON
      // field. Fill from the template contract instead of failing the create.
      if (isVoiceSurface(context)) {
        draft.systemPrompt = undefined;
      } else {
        const kit = buildPersonaDraftKit(draft, taken);
        return {
          success: false,
          output: formatPromptRequiredOutput(kit),
          error: 'PROMPT_REQUIRED',
          metadata: { code: 'PROMPT_REQUIRED', kit },
        };
      }
    }
    const prepared = prepareCustomCrew(draft, taken);
    const { profile, ...input } = prepared;
    const crew = mgr.create(input);
    await mgr.flushPersist();
    agentInstance.addCrewMember(crew);
    agentInstance.setCrewEnabled(crew.id, true);

    const lines = [
      `Created custom crew ${crew.name} (@${crew.callsign}).`,
      crew.title ? `Title: ${crew.title}` : '',
      `Tone: ${crew.emotion ?? 'professional'} · template: ${profile}`,
      crew.expertise?.length ? `Skills: ${crew.expertise.join(', ')}` : '',
      crew.traits?.length ? `Traits: ${crew.traits.join(', ')}` : '',
      'They are on the roster and enabled. The owner can @mention them or open a private chat / voice call.',
    ].filter(Boolean);

    return {
      success: true,
      output: lines.join('\n'),
      metadata: {
        id: crew.id,
        name: crew.name,
        title: crew.title,
        callsign: crew.callsign,
        emotion: crew.emotion,
        expertise: crew.expertise,
        traits: crew.traits,
        profile,
      },
    };
  } catch (err) {
    return {
      success: false,
      output: err instanceof Error ? err.message : 'Failed to create crew',
      error: 'CREATE_FAILED',
    };
  }
}
