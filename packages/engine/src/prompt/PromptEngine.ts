/**
 * RAG context formatting utility.
 *
 * The MoE Prompt Assembler (PromptAssembly + CategoryDetector) now handles
 * intent detection, tool selection, reasoning mode, and system prompt assembly.
 * This module is retained solely for `buildRagContext`, which formats
 * knowledge-base search results into a structured prompt block.
 */

/**
 * Build RAG context from search results.
 */
export function buildRagContext(results: Array<{ content: string; score?: number; metadata?: Record<string, unknown> }>): string {
  if (results.length === 0) return '';

  const parts = results.map((r, i) => {
    const sourceName =
      (r.metadata?.['sourceName'] as string | undefined) ||
      (r.metadata?.['source'] as string | undefined) ||
      (r.metadata?.['docId'] as string | undefined) ||
      `doc-${i}`;
    const page = r.metadata?.['pageNumber'];
    const kind = r.metadata?.['kind'];
    const label = [
      sourceName,
      kind ? String(kind) : null,
      page != null ? `p.${page}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const body = r.content.length > 2800 ? `${r.content.slice(0, 2800)}…` : r.content;
    return `[${label}]\n${body}`;
  });

  return `[RELEVANT_DOCUMENTS]\nThe following knowledge-base / indexed excerpts may help answer the user's query. Prefer body text over table-of-contents lines. For more depth, call knowledge_base_search with a precise query.\n\n${parts.join('\n\n')}\n[/RELEVANT_DOCUMENTS]`;
}
