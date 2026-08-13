import type { PermissionHandlerResult } from '@agentx/shared';
import {
  VOICE_PERMISSION_COLLECT_MS,
  VOICE_PERMISSION_MAX_CLARIFY,
  VOICE_PERMISSION_TIMEOUT_INSTRUCTION,
  VOICE_PERMISSION_TIMEOUT_MS,
  VOICE_PERMISSION_CLARIFY_LINE,
} from '@agentx/shared';
import { classifyVoicePermissionUtterance } from './voice-permission-intent.js';

export interface VoicePermissionAskItem {
  requestId: string;
  tool: string;
  riskLevel: string;
  argsSummary?: string;
}

type Settler = (result: PermissionHandlerResult) => void;

interface GatedItem extends VoicePermissionAskItem {
  settle: Settler;
}

export interface VoicePermissionGateHooks {
  speak: (line: string) => Promise<void>;
  agentName?: () => string;
  onOpenMic?: () => Promise<void> | void;
}

function friendlyToolName(tool: string): string {
  return tool.replace(/^integration__/, '').replace(/_/g, ' ');
}

export function buildVoicePermissionSpokenPrompt(
  items: VoicePermissionAskItem[],
  agentName = 'Agent-X',
): string {
  const unique = items.filter((item, i, arr) => arr.findIndex((x) => x.requestId === item.requestId) === i);
  if (unique.length === 0) return '';

  const highRisk = unique.some((i) => i.riskLevel === 'critical' || i.riskLevel === 'high');
  const riskNote = highRisk ? ' This includes a higher-risk action.' : '';

  if (unique.length === 1) {
    const item = unique[0]!;
    const action = item.argsSummary?.trim() || `use ${friendlyToolName(item.tool)}`;
    return `${agentName} needs to ${action}.${riskNote} Should I go ahead?`;
  }

  const lines = unique.map((item, idx) => {
    const action = item.argsSummary?.trim() || `use ${friendlyToolName(item.tool)}`;
    return `${idx + 1}: ${action}`;
  });
  return `${agentName} needs a few tools: ${lines.join('; ')}.${riskNote} Should I go ahead with all of them?`;
}

/**
 * Collects concurrent voice tool-permission asks into one spoken confirmation,
 * classifies natural-language replies, and clarifies when unsure.
 */
export class VoicePermissionGate {
  private items: GatedItem[] = [];
  private collectTimer?: ReturnType<typeof setTimeout>;
  private timeoutTimer?: ReturnType<typeof setTimeout>;
  private spoken = false;
  private clarifyCount = 0;
  private speaking = false;
  private disposed = false;
  private bufferedUtterance?: string;

  constructor(private readonly hooks: VoicePermissionGateHooks) {}

  get pending(): boolean {
    return this.items.length > 0 && !this.disposed;
  }

  get awaitingReply(): boolean {
    return this.spoken && this.pending && !this.speaking;
  }

  add(item: VoicePermissionAskItem, settle: Settler): void {
    if (this.disposed) {
      settle({ type: 'instruct', instruction: VOICE_PERMISSION_TIMEOUT_INSTRUCTION });
      return;
    }
    const existing = this.items.find((i) => i.requestId === item.requestId);
    if (existing) {
      const prev = existing.settle;
      existing.settle = (result) => {
        prev(result);
        settle(result);
      };
      existing.argsSummary = item.argsSummary ?? existing.argsSummary;
      existing.riskLevel = item.riskLevel || existing.riskLevel;
      return;
    }
    this.items.push({ ...item, settle });
    this.scheduleSpeak();
  }

  /**
   * Consume a user utterance as a permission decision.
   * Returns true when a permission prompt was pending (utterance must not start a new turn).
   */
  async handleUtterance(raw: string): Promise<boolean> {
    if (!this.pending) return false;
    if (!this.spoken) {
      // Collect window: keep the utterance and apply after the prompt is spoken.
      this.bufferedUtterance = raw;
      return true;
    }
    return this.applyUtterance(raw);
  }

  private async applyUtterance(raw: string): Promise<boolean> {
    if (!this.pending) return false;
    const intent = classifyVoicePermissionUtterance(raw);
    if (intent === 'allow_once') {
      this.finish('allow_once');
      return true;
    }
    if (intent === 'deny') {
      this.finish('deny');
      return true;
    }
    this.clarifyCount += 1;
    if (this.clarifyCount > VOICE_PERMISSION_MAX_CLARIFY) {
      this.finish({ type: 'instruct', instruction: VOICE_PERMISSION_TIMEOUT_INSTRUCTION });
      await this.hooks.speak("I still didn't get a clear yes or no, so I'll skip those tools.");
      return true;
    }
    this.resetTimeout();
    await this.speakLine(VOICE_PERMISSION_CLARIFY_LINE);
    return true;
  }

  cancelAll(result: PermissionHandlerResult = 'deny'): void {
    this.finish(result);
  }

  dispose(): void {
    this.disposed = true;
    this.finish({ type: 'instruct', instruction: VOICE_PERMISSION_TIMEOUT_INSTRUCTION });
  }

  private scheduleSpeak(): void {
    if (this.collectTimer) clearTimeout(this.collectTimer);
    this.collectTimer = setTimeout(() => {
      this.collectTimer = undefined;
      void this.speakPrompt();
    }, this.spoken ? 200 : VOICE_PERMISSION_COLLECT_MS);
  }

  private async speakPrompt(): Promise<void> {
    if (!this.pending) return;
    if (this.speaking) {
      this.scheduleSpeak();
      return;
    }
    const buffered = this.bufferedUtterance;
    this.bufferedUtterance = undefined;
    if (buffered) {
      const early = classifyVoicePermissionUtterance(buffered);
      if (early === 'allow_once' || early === 'deny') {
        this.spoken = true;
        this.finish(early);
        return;
      }
    }
    const name = this.hooks.agentName?.() ?? 'Agent-X';
    const line = buildVoicePermissionSpokenPrompt(this.items, name);
    this.spoken = true;
    this.resetTimeout();
    await this.speakLine(line);
    await this.hooks.onOpenMic?.();
    if (buffered) await this.applyUtterance(buffered);
  }

  private async speakLine(line: string): Promise<void> {
    this.speaking = true;
    try {
      await this.hooks.speak(line);
    } catch { /* best-effort TTS */ } finally {
      this.speaking = false;
    }
  }

  private resetTimeout(): void {
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    this.timeoutTimer = setTimeout(() => {
      if (!this.pending) return;
      this.finish({ type: 'instruct', instruction: VOICE_PERMISSION_TIMEOUT_INSTRUCTION });
      void this.hooks.speak('No confirmation — I skipped those tools.');
    }, VOICE_PERMISSION_TIMEOUT_MS);
  }

  private finish(result: PermissionHandlerResult): void {
    if (this.collectTimer) {
      clearTimeout(this.collectTimer);
      this.collectTimer = undefined;
    }
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }
    const items = this.items;
    this.items = [];
    this.spoken = false;
    this.clarifyCount = 0;
    this.bufferedUtterance = undefined;
    for (const item of items) {
      try { item.settle(result); } catch { /* ignore */ }
    }
  }
}
