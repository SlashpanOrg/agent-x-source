import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getSecretSauceDir } from '../config/paths.js';

interface SummarizationState {
  lastMemorySummarization: string;
  lastDiarySummarization: string;
  memorySummary: string;
  diarySummary: string;
}

/**
 * Periodically summarizes Secret Sauce data (memories + diary) to keep context compact.
 * Uses an LLM call to consolidate older entries into summaries.
 * Triggered after N interactions or on session start if stale.
 */
export class SecretSauceSummarizer {
  private state: SummarizationState;
  private secretSauceDir: string;
  private stateFile: string;
  private summarizeThresholdHours = 24;

  constructor() {
    this.secretSauceDir = getSecretSauceDir();
    this.stateFile = join(this.secretSauceDir, 'summarization-state.json');
    this.state = this.load();
  }

  private load(): SummarizationState {
    if (existsSync(this.stateFile)) {
      try {
        return JSON.parse(readFileSync(this.stateFile, 'utf-8')) as SummarizationState;
      } catch {
        // Fall through to default
      }
    }
    return {
      lastMemorySummarization: '',
      lastDiarySummarization: '',
      memorySummary: '',
      diarySummary: '',
    };
  }

  private save(): void {
    mkdirSync(this.secretSauceDir, { recursive: true });
    writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
  }

  /**
   * Check if summarization is needed (stale by threshold).
   */
  needsSummarization(): boolean {
    const now = Date.now();
    const lastMemTs = this.state.lastMemorySummarization
      ? new Date(this.state.lastMemorySummarization).getTime()
      : 0;
    const lastDiaryTs = this.state.lastDiarySummarization
      ? new Date(this.state.lastDiarySummarization).getTime()
      : 0;

    const thresholdMs = this.summarizeThresholdHours * 60 * 60 * 1000;
    return (now - lastMemTs > thresholdMs) || (now - lastDiaryTs > thresholdMs);
  }

  /**
   * Build a summarization prompt for memory entries.
   */
  buildMemorySummarizationPrompt(memories: Array<{ content: string; category: string; timestamp: string }>): string {
    if (memories.length === 0) return '';

    const lines = memories.map((m) => `[${m.category}] (${m.timestamp.split('T')[0]}) ${m.content}`);

    return `You are summarizing user memories for an AI assistant's long-term memory.
Consolidate the following ${memories.length} memory entries into a concise summary.
Group by category, merge duplicates, keep the most important facts.
Output ONLY the consolidated summary (max 500 words). No preamble.

MEMORIES:
${lines.join('\n')}`;
  }

  /**
   * Build a summarization prompt for diary entries.
   */
  buildDiarySummarizationPrompt(entries: Array<{ date: string; summary: string; highlights: string[] }>): string {
    if (entries.length === 0) return '';

    const lines = entries.map((e) => {
      const hl = e.highlights.length > 0 ? ` | Highlights: ${e.highlights.join(', ')}` : '';
      return `[${e.date}] ${e.summary}${hl}`;
    });

    return `You are summarizing a diary for an AI assistant.
Consolidate the following ${entries.length} daily diary entries into a brief overview.
Focus on patterns, recurring topics, and key milestones.
Output ONLY the consolidated summary (max 300 words). No preamble.

DIARY ENTRIES:
${lines.join('\n')}`;
  }

  /**
   * Store the summarized result for memories.
   */
  storeMemorySummary(summary: string): void {
    this.state.memorySummary = summary;
    this.state.lastMemorySummarization = new Date().toISOString();
    this.save();
  }

  /**
   * Store the summarized result for diary.
   */
  storeDiarySummary(summary: string): void {
    this.state.diarySummary = summary;
    this.state.lastDiarySummarization = new Date().toISOString();
    this.save();
  }

  /**
   * Get the current stored summaries for injection into context.
   */
  getSummaries(): { memorySummary: string; diarySummary: string } {
    return {
      memorySummary: this.state.memorySummary,
      diarySummary: this.state.diarySummary,
    };
  }

  /**
   * Get context string for system prompt inclusion.
   */
  buildContext(): string {
    const parts: string[] = [];
    if (this.state.memorySummary) {
      parts.push(`[MEMORY_SUMMARY]\n${this.state.memorySummary}\n[/MEMORY_SUMMARY]`);
    }
    if (this.state.diarySummary) {
      parts.push(`[DIARY_SUMMARY]\n${this.state.diarySummary}\n[/DIARY_SUMMARY]`);
    }
    return parts.join('\n\n');
  }
}
