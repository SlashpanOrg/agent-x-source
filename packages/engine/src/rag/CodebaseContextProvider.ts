import type { RAGEngine } from './RAGEngine.js';

export class CodebaseContextProvider {
  private ragEngine: RAGEngine | null = null;

  setRAGEngine(engine: RAGEngine | null): void {
    this.ragEngine = engine;
  }

  isAvailable(): boolean {
    return this.ragEngine !== null && this.ragEngine.isEnabled;
  }

  async getContext(query: string, maxResults = 5): Promise<string> {
    if (!this.ragEngine || !this.ragEngine.isEnabled) return '';

    try {
      const results = await this.ragEngine.search(query, maxResults);
      if (results.length === 0) return '';

      const lines: string[] = ['Relevant codebase context:'];
      for (const doc of results) {
        const path = doc.metadata?.['path'] ?? 'unknown';
        const content = doc.metadata?.['content'] as string ?? '';
        const score = doc.score ?? 0;
        const snippet = content.slice(0, 300).trim();
        lines.push(`  📄 ${path} (score: ${score.toFixed(2)})`);
        lines.push(`    ${snippet}`);
        if (content.length > 300) lines.push('    ...');
      }
      return lines.join('\n');
    } catch {
      return '';
    }
  }
}

export function extractCodebaseQuery(input: string): { query: string; clean: string } | null {
  const match = input.match(/@codebase\s*\(([^)]*)\)/);
  if (match) {
    const query = match[1]?.trim() || '';
    const clean = input.replace(match[0], '').trim();
    return { query, clean };
  }

  // Bare @codebase without query — use the full input
  if (input.includes('@codebase')) {
    const clean = input.replace(/@codebase\s*/, '').trim();
    return { query: clean, clean };
  }

  return null;
}
