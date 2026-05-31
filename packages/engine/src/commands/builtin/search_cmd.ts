import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';
import { getRAGEngineInstance } from './rag_index.js';

function confidenceLabel(score: number): string {
  if (score >= 0.8) return 'HIGH';
  if (score >= 0.5) return 'MEDIUM';
  return 'LOW';
}

function buildFileTree(paths: string[]): string {
  const tree: Record<string, string[]> = {};
  for (const p of paths) {
    const parts = p.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    const file = parts[parts.length - 1] ?? p;
    if (!tree[dir]) tree[dir] = [];
    tree[dir]!.push(file);
  }
  const lines: string[] = [];
  for (const [dir, files] of Object.entries(tree)) {
    lines.push(`  ${dir}/`);
    for (const f of files) {
      lines.push(`    ${f}`);
    }
  }
  return lines.join('\n');
}

export const searchCommand: CommandInterface = {
  name: 'search',
  description: 'Semantic codebase search using RAG',
  usage: '/search <query> [--topk <n>] [--hybrid] [--tree]',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    const topkIdx = args.indexOf('--topk');
    const topK = topkIdx !== -1 ? parseInt(args[topkIdx + 1], 10) || 5 : 5;
    const hybrid = args.includes('--hybrid');
    const showTree = args.includes('--tree');
    const query = args.filter((a) => !a.startsWith('--')).join(' ');

    const rag = getRAGEngineInstance();
    if (!rag || !rag.isEnabled) {
      context.emit('RAG engine not available. Run /index first.');
      return { success: false, action: 'none' };
    }

    if (showTree) {
      const paths = rag.listIndexedPaths();
      if (paths.length === 0) {
        context.emit('No indexed files. Run /index first.');
        return { success: true, action: 'none' };
      }
      context.emit(`Indexed files (${paths.length}):\n${buildFileTree(paths)}`);
      return { success: true, action: 'none' };
    }

    if (!query) {
      context.emit('Usage: /search <query> [--topk <n>] [--hybrid] [--tree]');
      return { success: false, action: 'none' };
    }

    try {
      const results = await rag.search(query, topK, hybrid);
      if (results.length === 0) {
        context.emit(`No results found for "${query}".`);
        return { success: true, action: 'none' };
      }

      const label = hybrid ? 'Hybrid' : 'Semantic';
      const lines: string[] = [`${label} search results for "${query}":`];
      for (const doc of results) {
        const path = (doc.metadata?.['path'] as string) ?? 'unknown';
        const content = (doc.metadata?.['content'] as string) ?? '';
        const score = doc.score ?? 0;
        const snippet = content.slice(0, 200).replace(/\n/g, '↵');
        const conf = confidenceLabel(score);
        const confColor = conf === 'HIGH' ? '+' : conf === 'MEDIUM' ? '~' : '-';
        lines.push(`  [${confColor}] [${(score * 100).toFixed(0)}%] ${conf} — ${path}`);
        lines.push(`    ${snippet}`);
      }
      context.emit(lines.join('\n'));
      return { success: true, action: 'none' };
    } catch (err) {
      context.emit(`Search failed: ${(err as Error).message}`);
      return { success: false, action: 'none' };
    }
  },
};
