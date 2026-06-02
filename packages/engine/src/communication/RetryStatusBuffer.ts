export class RetryStatusBuffer {
  private buffer = new Map<string, string[]>();

  add(turnId: string, message: string): void {
    const entries = this.buffer.get(turnId) ?? [];
    entries.push(message);
    this.buffer.set(turnId, entries);
  }

  flush(turnId: string): string {
    const entries = this.buffer.get(turnId) ?? [];
    this.buffer.delete(turnId);
    return entries.join('\n');
  }

  getEntries(turnId: string): string[] {
    return [...(this.buffer.get(turnId) ?? [])];
  }

  hasEntries(turnId: string): boolean {
    return (this.buffer.get(turnId)?.length ?? 0) > 0;
  }

  clear(): void {
    for (const [turnId] of this.buffer) {
      this.buffer.delete(turnId);
    }
  }

  reset(): void {
    this.buffer.clear();
  }
}
