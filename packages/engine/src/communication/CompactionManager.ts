import type {
  CompactionSummary,
  CompactionMarker,
  Message,
} from '@agentx/shared';
import { CompactionSummarizer } from './CompactionSummarizer.js';
import { PostCompactionGuard } from './PostCompactionGuard.js';

export interface CompactionConfig {
  contextLimit: number;
  warnThreshold: number;
  triggerThreshold: number;
  tailBufferTokens: number;
  maxTailTokens: number;
  minTailTokens: number;
}

const DEFAULT_CONFIG: CompactionConfig = {
  contextLimit: 128000,
  warnThreshold: 0.8,
  triggerThreshold: 0.85,
  tailBufferTokens: 0.25,
  maxTailTokens: 8000,
  minTailTokens: 2000,
};

export interface CompactionResult {
  ok: boolean;
  tokensSaved: number;
  summary: CompactionSummary;
  compactedMessages: Message[];
  marker: CompactionMarker;
}

export class CompactionManager {
  private config: CompactionConfig;
  private summarizer: CompactionSummarizer;
  private guard: PostCompactionGuard;

  constructor(config: Partial<CompactionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.summarizer = new CompactionSummarizer();
    this.guard = new PostCompactionGuard();
  }

  needsCompaction(currentTokens: number): boolean {
    return (
      currentTokens >= this.config.contextLimit * this.config.triggerThreshold
    );
  }

  needsWarning(currentTokens: number): boolean {
    return currentTokens >= this.config.contextLimit * this.config.warnThreshold;
  }

  isOverflowed(currentTokens: number): boolean {
    return currentTokens >= this.config.contextLimit * 0.95;
  }

  isThreeLevelEscalation(
    currentTokens: number,
    attempt: number,
  ): 'level1' | 'level2' | 'level3' | null {
    if (currentTokens > this.config.contextLimit * 0.65 && attempt === 1) {
      return 'level1';
    }
    if (attempt >= 2 && attempt <= 4) {
      return 'level2';
    }
    if (attempt >= 5) {
      return 'level3';
    }
    return null;
  }

  async compact(
    messages: Message[],
    sessionId: string,
  ): Promise<CompactionResult> {
    if (this.guard.isLooping(sessionId)) {
      throw new Error(
        `Post-compaction loop detected for session ${sessionId}`,
      );
    }

    const { tail, head } = this.splitHeadTail(messages);
    const summary = await this.summarizer.summarize(head, tail);

    const marker: CompactionMarker = {
      messageId: `compaction-${Date.now()}`,
      summaryIndex: head.length,
      tailStartIndex: messages.length - tail.length,
      createdAt: Date.now(),
    };

    const tokensSaved = this.estimateTokens(head);

    const compactedMessages = this.reconstructMessages(
      summary,
      tail,
      marker,
      sessionId,
    );

    return {
      ok: true,
      tokensSaved,
      summary,
      compactedMessages,
      marker,
    };
  }

  private splitHeadTail(
    messages: Message[],
  ): { tail: Message[]; head: Message[] } {
    const tailBudget = Math.max(
      this.config.minTailTokens,
      Math.min(
        this.config.maxTailTokens,
        Math.floor(this.config.contextLimit * this.config.tailBufferTokens),
      ),
    );

    let accumulatedTokens = 0;
    const tail: Message[] = [];

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]!;
      const msgTokens = this.estimateMessageTokens(msg);

      if (accumulatedTokens + msgTokens <= tailBudget) {
        tail.unshift(msg);
        accumulatedTokens += msgTokens;
      } else {
        break;
      }
    }

    const head = messages.slice(0, messages.length - tail.length);
    return { tail, head };
  }

  private reconstructMessages(
    summary: CompactionSummary,
    tail: Message[],
    marker: CompactionMarker,
    sessionId: string,
  ): Message[] {
    const summaryText = CompactionSummarizer.formatSummary(summary);

    const summaryMessage: Message = {
      id: marker.messageId,
      sessionId,
      role: 'system',
      content: summaryText,
      toolCalls: null,
      tokenCount: 0,
      createdAt: new Date().toISOString(),
      compactionMarker: marker,
    };

    return [summaryMessage, ...tail];
  }

  private estimateTokens(messages: Message[]): number {
    return messages.reduce(
      (sum, m) => sum + this.estimateMessageTokens(m),
      0,
    );
  }

  private estimateMessageTokens(message: Message): number {
    const text =
      message.content +
      (message.reasoning ?? '') +
      (message.toolCalls
        ? message.toolCalls
            .map((tc) => tc.arguments + (tc.result ?? ''))
            .join('')
        : '');

    return Math.ceil(text.length / 4);
  }

  getGuard(): PostCompactionGuard {
    return this.guard;
  }
}
