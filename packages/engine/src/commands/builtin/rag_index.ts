import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';
import type { RAGEngine } from '../../rag/RAGEngine.js';
import type { EngineEvent } from '@agentx/shared';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { execSync } from 'node:child_process';

let ragEngineInstance: RAGEngine | null = null;
let fileWatcherForIndex: ReturnType<typeof import('fs').watch> | null = null;

export function setRAGEngineInstance(engine: RAGEngine | null): void {
  ragEngineInstance = engine;
}

export function getRAGEngineInstance(): RAGEngine | null {
  return ragEngineInstance;
}

interface EventBusLike {
  emit(event: EngineEvent): void;
}

let eventBusInstance: EventBusLike | null = null;

export function setIndexerEventBus(eb: EventBusLike | null): void {
  eventBusInstance = eb;
}

const DEFAULT_GLOB = '**/*.{ts,tsx,js,jsx,mjs,cjs,json,md,yml,yaml,toml,env}';

export const ragIndexCommand: CommandInterface = {
  name: 'index',
  description: 'Index the codebase for RAG-based @codebase queries',
  usage: '/index [path] [--reset] [--watch]',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    if (!ragEngineInstance || !ragEngineInstance.isEnabled) {
      context.emit('RAG engine not available or disabled. Enable it in config (rag.enabled: true).');
      return { success: false, action: 'none' };
    }

    const pathArg = args[0] && !args[0].startsWith('--') ? args[0] : '.';
    const reset = args.includes('--reset');
    const watch = args.includes('--watch');
    const root = resolve(pathArg);

    context.emit('Indexing codebase...');

    if (reset) {
      await ragEngineInstance.clearAll();
      context.emit('Cleared existing index.');
    }

    let files: string[];
    try {
      const output = execSync(
        `find "${root}" -type f \\( ${DEFAULT_GLOB.replace(/[{}]/g, '').split(',').map((ext) => `-name "*${ext}"`).join(' -o ')} \\) -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" 2>/dev/null | head -500`,
        { encoding: 'utf-8', timeout: 30000 },
      );
      files = output.trim().split('\n').filter(Boolean);
    } catch {
      context.emit('Failed to list files.');
      return { success: false, action: 'none' };
    }

    if (files.length === 0) {
      context.emit('No indexable files found.');
      return { success: true, action: 'none' };
    }

    let indexed = 0;
    const batchSize = 10;
    const total = files.length;

    context.emit(`Indexing ${total} files in batches...`);
    eventBusInstance?.emit({ type: 'indexing_start', totalFiles: total } as EngineEvent);

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      const docs = batch.map((file) => {
        try {
          const content = readFileSync(file, 'utf-8').slice(0, 8000);
          return { content, metadata: { path: relative(root, file), source: 'codebase' } };
        } catch {
          return null;
        }
      }).filter(Boolean) as Array<{ content: string; metadata: Record<string, unknown> }>;

      if (docs.length > 0) {
        await ragEngineInstance.indexDocuments(docs);
        indexed += docs.length;
      }

      const pct = Math.round((indexed / total) * 100);
      eventBusInstance?.emit({
        type: 'indexing_progress',
        indexed,
        total,
        currentFile: batch[0] ? relative(root, batch[0]) : undefined,
      } as EngineEvent);

      if (i % 50 === 0 || i + batchSize >= total) {
        context.emit(`  Indexing... ${indexed}/${total} files (${pct}%)`);
      }
    }

    const count = await ragEngineInstance.chunkCount();
    context.emit(`Indexed ${indexed} files (${count} chunks) from ${total} files scanned.`);
    eventBusInstance?.emit({ type: 'indexing_complete', indexed, total, chunks: count } as EngineEvent);

    // Start auto-watch if --watch flag
    if (watch) {
      startAutoReindex(root, context);
    }

    return { success: true, action: 'none' };
  },
};

function startAutoReindex(root: string, context: CommandContext): void {
  try {
    const fs = require('fs');
    if (fileWatcherForIndex) {
      fileWatcherForIndex.close();
    }
    context.emit('  Watching for file changes to auto-reindex...');
    fileWatcherForIndex = fs.watch(root, { recursive: true }, (eventType: string, filename: string | null) => {
      if (!filename) return;
      const ext = filename.split('.').pop();
      const indexableExts = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'md', 'yml', 'yaml', 'toml', 'env'];
      if (ext && indexableExts.includes(ext) && !filename.includes('node_modules') && !filename.includes('.git')) {
        // Debounce: re-index only the changed file
        if (ragEngineInstance && ragEngineInstance.isEnabled) {
          const fullPath = resolve(root, filename);
          try {
            const content = readFileSync(fullPath, 'utf-8').slice(0, 8000);
            ragEngineInstance.indexDocuments([{ content, metadata: { path: filename, source: 'codebase' } }]);
          } catch {
            // File may have been deleted
          }
        }
      }
    });
  } catch {
    // fs.watch recursive may not be available on all platforms
  }
}
