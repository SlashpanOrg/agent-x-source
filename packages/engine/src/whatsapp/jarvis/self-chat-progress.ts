/**
 * Live WhatsApp self-chat progress.
 *
 * WhatsApp has no typing-as-loading UI for "Message yourself", so a dashboard-style
 * turn is surfaced as short [Agent-X] bubbles driven by engine events — not by
 * hardcoded query text.
 */
import type { EngineEvent, QuestionnairePayload } from '@agentx/shared';

export type WhatsAppProgressKind = 'ack' | 'tool' | 'crew' | 'wait' | 'ask' | 'info';

export const WHATSAPP_PROGRESS_THROTTLE_MS = 2800;
export const WHATSAPP_PROGRESS_HEARTBEAT_MS = 8000;
export const WHATSAPP_PROGRESS_MAX_LINES = 10;
export const WHATSAPP_CHUNK_LIMIT = 3500;
export const WHATSAPP_TYPING_REFRESH_MS = 8000;

/** Tools that are too noisy or recursive to announce as WhatsApp fillers. */
const SKIP_TOOLS = new Set([
  'todo_write',
  'ask_clarification',
  'present_visual',
  'whatsapp_get_message_history',
  'whatsapp_send_text',
  'whatsapp_send_image',
  'whatsapp_send_video',
  'whatsapp_send_document',
  'whatsapp_send_audio',
  'whatsapp_react',
  'whatsapp_edit_message',
]);

const TOOL_LINES: Record<string, string> = {
  web_search: 'Browsing the internet.',
  deep_web_search: 'Browsing the internet.',
  web_browse: 'Browsing the internet.',
  web_fetch: 'Opening a page.',
  web_scrape: 'Opening a page.',
  http_get: 'Fetching data.',
  knowledge_base_search: 'Accessing the knowledge base.',
  cortex_memory_search: 'Searching memory.',
  memory_recall: 'Searching memory.',
  memory_store: 'Saving to memory.',
  codebase_search: 'Searching the codebase.',
  code_search: 'Searching the codebase.',
  shell: 'Running a command.',
  shell_exec: 'Running a command.',
  file_read: 'Reading a file.',
  file_write: 'Updating a file.',
  file_edit: 'Updating a file.',
  code_replace: 'Updating a file.',
  code_insert: 'Updating a file.',
  delegate_to_subagent: 'A helper is on it.',
  delegate_to_crew: 'A crew member is on it.',
  spawn_crew_workers: 'Crew is on it.',
  crew_member: 'A crew member is on it.',
  git_commit: 'Committing changes.',
  git_push: 'Pushing changes.',
  test_run: 'Running tests.',
  rag_search: 'Accessing the knowledge base.',
};

export function ownerCallsign(raw: string | undefined | null): string {
  const name = (raw ?? '').trim();
  return name || 'sir';
}

export function checkingLine(callsign: string): string {
  const name = ownerCallsign(callsign);
  return `Checking, ${name}.`;
}

export function whatsappLineForTool(tool: string, description?: string): string | null {
  const id = tool.trim();
  if (!id || SKIP_TOOLS.has(id)) return null;
  if (TOOL_LINES[id]) return TOOL_LINES[id];

  if (/web|search|browse|fetch|scrape/i.test(id)) return 'Browsing the internet.';
  if (/knowledge|rag|\bkb\b/i.test(id)) return 'Accessing the knowledge base.';
  if (/memory|cortex|recall/i.test(id)) return 'Searching memory.';
  if (/shell|exec|command|terminal/i.test(id)) return 'Running a command.';
  if (/file_read|read_file/i.test(id)) return 'Reading a file.';
  if (/file_|write|edit|replace/i.test(id)) return 'Updating a file.';
  if (/crew|delegate|subagent/i.test(id)) return 'A crew member is on it.';
  if (/git/i.test(id)) return 'Working with git.';
  if (/test/i.test(id)) return 'Running tests.';

  const desc = description?.replace(/\s+/g, ' ').trim();
  if (desc && desc.length <= 80 && !desc.includes('{') && !desc.includes('[')) {
    const punct = /[.!?]$/.test(desc) ? '' : '.';
    return desc.charAt(0).toUpperCase() + desc.slice(1) + punct;
  }

  const label = id.replace(/_/g, ' ').trim();
  if (!label) return null;
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}.`;
}

export function formatQuestionnaireForWhatsApp(payload: QuestionnairePayload): string {
  const lines: string[] = ['I need a bit more from you:'];
  if (payload.title?.trim()) {
    lines.push(`*${payload.title.trim()}*`);
  }
  for (const [i, q] of payload.questions.entries()) {
    const prompt = q.prompt?.trim() || 'Could you clarify?';
    lines.push(payload.questions.length > 1 ? `${i + 1}. ${prompt}` : prompt);
    if (q.type === 'single_choice' || q.type === 'multi_choice') {
      (q.options ?? []).forEach((o, j) => {
        const suggested = o.recommended ? ' (suggested)' : '';
        const disabled = o.disabled ? ' (unavailable)' : '';
        lines.push(`   ${j + 1}) ${o.label ?? o.value}${suggested}${disabled}`);
      });
    }
  }
  lines.push('Reply here with the number or your answer.');
  if (payload.allowSkip) lines.push('Or say skip.');
  return lines.filter(Boolean).join('\n');
}

export function formatPermissionPrompt(ev: {
  tool?: string;
  path?: string;
  riskLevel?: string;
  commandPreview?: string;
  argsSummary?: string;
}): string {
  const tool = (ev.tool ?? 'a tool').replace(/_/g, ' ');
  const risk = ev.riskLevel ? ` (${ev.riskLevel} risk)` : '';
  const target = ev.path?.trim() ? ` on ${ev.path.trim()}` : '';
  const lines = [`I need your OK to use ${tool}${target}${risk}.`];
  const preview = (ev.commandPreview ?? ev.argsSummary ?? '').trim();
  if (preview) lines.push(preview.length > 240 ? `${preview.slice(0, 237)}…` : preview);
  lines.push('Reply yes, always, or no.');
  return lines.join('\n');
}

export function parsePermissionReply(text: string): 'allow_once' | 'allow_always' | 'deny' | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (/^(always|allow always|yes always|forever|allow forever)\b/.test(t)) return 'allow_always';
  if (/^(yes|y|ok|okay|allow|approve|go ahead|do it|sure|yep|yeah|proceed)\b/.test(t)) return 'allow_once';
  if (/^(no|n|deny|don't|dont|nope|reject)\b/.test(t)) return 'deny';
  return null;
}

export function isStopCommand(text: string): boolean {
  return /^(stop|cancel|abort|never mind|nevermind|forget it|forget that)\.?$/i.test(text.trim());
}

export function parseStepCapReply(text: string): boolean | null {
  const t = text.trim().toLowerCase();
  if (/^(continue|keep going|yes|y|go on|keep on|more)\.?$/.test(t)) return true;
  if (/^(stop|no|n|enough|that's enough|thats enough)\.?$/.test(t)) return false;
  return null;
}

export function chunkWhatsAppText(text: string, limit = WHATSAPP_CHUNK_LIMIT): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= limit) return [trimmed];
  const chunks: string[] = [];
  let rest = trimmed;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n\n', limit);
    if (cut < limit * 0.4) cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.4) cut = rest.lastIndexOf(' ', limit);
    if (cut < limit * 0.4) cut = limit;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export interface WhatsAppSelfChatProgressOptions {
  send: (text: string) => Promise<void>;
  callsign: string;
  throttleMs?: number;
  heartbeatMs?: number;
  maxProgress?: number;
}

export class WhatsAppSelfChatProgress {
  readonly startedAt = Date.now();
  pendingPermission: { requestId: string; tool: string } | null = null;
  awaitingClarification = false;
  awaitingStepCap = false;

  private readonly send: (text: string) => Promise<void>;
  private readonly callsign: string;
  private readonly throttleMs: number;
  private readonly heartbeatMs: number;
  private readonly maxProgress: number;
  private lastLine = '';
  private lastAt = 0;
  private lastToolLine = '';
  private progressCount = 0;
  private chain: Promise<void> = Promise.resolve();
  private stopped = false;
  private lastPermissionId = '';
  private lastQuestionnaireId = '';

  constructor(options: WhatsAppSelfChatProgressOptions) {
    this.send = options.send;
    this.callsign = options.callsign;
    this.throttleMs = options.throttleMs ?? WHATSAPP_PROGRESS_THROTTLE_MS;
    this.heartbeatMs = options.heartbeatMs ?? WHATSAPP_PROGRESS_HEARTBEAT_MS;
    this.maxProgress = options.maxProgress ?? WHATSAPP_PROGRESS_MAX_LINES;
  }

  async start(): Promise<void> {
    await this.emitLine(checkingLine(this.callsign), 'ack', true);
  }

  handleEngineEvent(event: EngineEvent | { type?: string; [key: string]: unknown }): void {
    const type = String(event.type ?? '');
    if (!type || type.startsWith('harness_') || type === 'goal_status_changed' || type === 'goal_continuation') {
      return;
    }

    if (type === 'permission_required' && typeof (event as { requestId?: unknown }).requestId === 'string') {
      const ev = event as { requestId: string; tool?: string };
      this.pendingPermission = { requestId: ev.requestId, tool: ev.tool ?? 'tool' };
    }
    if (type === 'permission_resolved') this.pendingPermission = null;
    if (type === 'clarification_required') this.awaitingClarification = true;
    if (type === 'step_cap_reached') this.awaitingStepCap = true;
    if (type === 'step_cap_continue') this.awaitingStepCap = false;

    const mapped = this.lineForEvent(event as unknown as Record<string, unknown>);
    if (!mapped) return;
    this.enqueue(() => this.emitLine(mapped.line, mapped.kind, mapped.bypass));
  }

  async flush(): Promise<void> {
    await this.chain;
  }

  stop(): void {
    this.stopped = true;
    this.pendingPermission = null;
    this.awaitingClarification = false;
    this.awaitingStepCap = false;
  }

  private enqueue(fn: () => Promise<void>): void {
    this.chain = this.chain.then(fn).catch(() => {});
  }

  private lineForEvent(event: Record<string, unknown>): { line: string; kind: WhatsAppProgressKind; bypass: boolean } | null {
    const type = String(event.type ?? '');

    if (type === 'tool_executing' || type === 'tool_called') {
      const tool = typeof event.tool === 'string' ? event.tool : '';
      const description = typeof event.description === 'string' ? event.description : undefined;
      const line = whatsappLineForTool(tool, description);
      if (!line || line === this.lastToolLine) return null;
      this.lastToolLine = line;
      return { line, kind: 'tool', bypass: true };
    }

    if (type === 'crew_activity') {
      if (event.activity === 'done') return null;
      const name = typeof event.crewName === 'string' && event.crewName.trim()
        ? event.crewName.trim()
        : 'A crew member';
      return { line: `${name} is on it.`, kind: 'crew', bypass: false };
    }

    if (type === 'crew_worker_progress' || type === 'crew_worker_spawned' || type === 'crew_mission_start') {
      return { line: 'Crew is on it.', kind: 'crew', bypass: false };
    }

    if (type === 'clarification_required' && event.questionnaire && typeof event.questionnaire === 'object') {
      const questionnaire = event.questionnaire as QuestionnairePayload;
      const id = questionnaire.id ?? '';
      if (id && id === this.lastQuestionnaireId) return null;
      this.lastQuestionnaireId = id;
      return { line: formatQuestionnaireForWhatsApp(questionnaire), kind: 'ask', bypass: true };
    }

    if (type === 'permission_required') {
      const requestId = typeof event.requestId === 'string' ? event.requestId : '';
      if (requestId && requestId === this.lastPermissionId) return null;
      this.lastPermissionId = requestId;
      return {
        line: formatPermissionPrompt({
          tool: typeof event.tool === 'string' ? event.tool : undefined,
          path: typeof event.path === 'string' ? event.path : undefined,
          riskLevel: typeof event.riskLevel === 'string' ? event.riskLevel : undefined,
          commandPreview: typeof event.commandPreview === 'string' ? event.commandPreview : undefined,
          argsSummary: typeof event.argsSummary === 'string' ? event.argsSummary : undefined,
        }),
        kind: 'ask',
        bypass: true,
      };
    }

    if (type === 'step_cap_reached') {
      return {
        line: 'This is taking more steps than usual. Reply continue or stop.',
        kind: 'ask',
        bypass: true,
      };
    }

    if (type === 'turn_heartbeat') {
      const elapsed = typeof event.elapsedMs === 'number' ? event.elapsedMs : Date.now() - this.startedAt;
      if (elapsed < this.heartbeatMs) return null;
      const seconds = Math.max(1, Math.round(elapsed / 1000));
      const line = seconds < 20
        ? 'Still working on that.'
        : `Still working — ${seconds}s in.`;
      return { line, kind: 'wait', bypass: false };
    }

    if (type === 'research_start' || type === 'research_query') {
      return { line: 'Researching that.', kind: 'info', bypass: false };
    }
    if (type === 'tot_start') {
      return { line: 'Working through options.', kind: 'info', bypass: false };
    }
    if (type === 'compaction_start') {
      return { line: 'Tidying context.', kind: 'info', bypass: false };
    }
    if (type === 'indexing_start') {
      return { line: 'Indexing files.', kind: 'info', bypass: false };
    }
    if (type === 'rag_queried') {
      return { line: 'Accessing the knowledge base.', kind: 'tool', bypass: true };
    }
    if (type === 'error' || type === 'provider_error') {
      if (event.recoverable !== true) return null;
      return { line: 'Hit a snag — retrying.', kind: 'info', bypass: false };
    }

    return null;
  }

  private async emitLine(line: string, kind: WhatsAppProgressKind, bypass: boolean): Promise<void> {
    if (this.stopped) return;
    const text = line.trim();
    if (!text) return;
    const now = Date.now();
    if (text === this.lastLine) return;
    if (!bypass && now - this.lastAt < this.throttleMs) return;
    if (kind !== 'ask' && kind !== 'ack' && this.progressCount >= this.maxProgress) return;
    this.lastLine = text;
    this.lastAt = now;
    if (kind !== 'ask') this.progressCount += 1;
    await this.send(text);
  }
}
