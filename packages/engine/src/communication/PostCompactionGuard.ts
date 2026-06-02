export class PostCompactionGuard {
  private toolCallsAfterCompaction = new Map<string, string[]>();
  private readonly MAX_SAME_TOOLS_AFTER_COMPACTION = 3;

  recordCompaction(sessionId: string): void {
    this.toolCallsAfterCompaction.set(sessionId, []);
  }

  recordToolCall(sessionId: string, toolName: string): void {
    const calls = this.toolCallsAfterCompaction.get(sessionId);
    if (calls) {
      calls.push(toolName);
    }
  }

  isLooping(sessionId: string): boolean {
    const calls = this.toolCallsAfterCompaction.get(sessionId);
    if (!calls) return false;

    const toolCounts = new Map<string, number>();
    for (const call of calls) {
      toolCounts.set(call, (toolCounts.get(call) ?? 0) + 1);
    }

    for (const count of toolCounts.values()) {
      if (count >= this.MAX_SAME_TOOLS_AFTER_COMPACTION) {
        return true;
      }
    }

    return false;
  }

  clear(sessionId: string): void {
    this.toolCallsAfterCompaction.delete(sessionId);
  }

  getCallCount(sessionId: string): number {
    return this.toolCallsAfterCompaction.get(sessionId)?.length ?? 0;
  }
}
