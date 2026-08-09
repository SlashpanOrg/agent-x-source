/**
 * Memory extraction and web search ingestion helpers extracted from Agent.ts (REFACTOR-2).
 */
import { getLogger, isMemoryFabricSuperSession, resolveMemoryFabricWriteSessionId, type SessionContextKind, type EmbeddingProvider, type CompletionRequest } from '@agentx/shared';
import { ChatTurnMemoryIngester } from '../neural/ChatTurnMemoryIngester.js';
import { SessionFindingsIngester, type ToolFindingRecord, SESSION_FINDINGS_TAG } from '../neural/SessionFindingsIngester.js';
import { UserChatMemoryIngester } from '../neural/UserChatMemoryIngester.js';
import type { MemoryFabric, MemoryNode } from '../neural/MemoryFabric.js';
import type { ProviderInterface } from '../providers/ProviderInterface.js';
import { vectorMemoryPrefetch } from '../neural/VectorMemoryPrefetch.js';
import {
  getRetrievalSettings,
  applyScoreGate,
  heuristicRerank,
  toEvidenceUnit,
  packEvidenceBlocks,
  EMPTY_EVIDENCE_MARKER,
  expandEvidenceNeighborhood,
  type EvidenceUnit,
} from '../neural/retrieval/index.js';

export interface MemoryContextContext {
  messages: Array<{ role: string; content: string | unknown }>;
  reformulateQuery(rawQuery: string): Promise<string>;
  sessionId: string;
  options: { contextKind?: SessionContextKind };
  memoryFabric: MemoryFabric | null;
  memoryEmbedder: EmbeddingProvider | null;
  usesCompactContext(): boolean;
  setMemoryContextNodeIds(ids: string[]): void;
  speakerId?: string | null;
  /** When true, skip retrieval entirely (voice continuation, retry, non-RAG turn). */
  skipRetrieval?: boolean;
}

/** Small-talk / acknowledgement patterns that never need RAG retrieval. */
const SMALL_TALK_PATTERNS = /^(thanks?|thank you|ok|okay|cool|nice|great|got it|sounds good|perfect|sure|yes|no|nope|yep|yeah|nah|stop|continue|go on|keep going|please|alright|roger|acknowledged|understood|done|finished|bye|goodbye|see you|talk later)\b[!.?]*$/i;

/**
 * Cheap heuristic: determine whether the turn needs RAG retrieval at all.
 * Returns true if retrieval SHOULD run, false to skip entirely (O(1) for non-RAG turns).
 */
function shouldRetrieve(query: string, skipRetrievalFlag?: boolean): boolean {
  if (skipRetrievalFlag) return false;
  const trimmed = query.trim();
  if (!trimmed) return false;
  // Pure small-talk / acknowledgements → no retrieval needed.
  if (SMALL_TALK_PATTERNS.test(trimmed)) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  // Very short messages with no question words and no technical nouns → skip.
  if (words.length < 5) {
    const hasQuestionWord = words.some((w) => /^(what|how|why|where|when|who|which|whose|whom)$/i.test(w));
    if (!hasQuestionWord) return false;
  }
  return true;
}

/** Session-scoped tool findings — always retrieved (even in light thinking mode). */
async function prefetchSessionScopedMemory(
  fabric: MemoryFabric,
  embedder: EmbeddingProvider,
  query: string,
  sessionId: string,
  maxChars: number,
): Promise<{ text: string; ids: string[] }> {
  const settings = getRetrievalSettings();
  const embedding = await embedder.embed(query.slice(0, 800));
  const overFetch = 10;
  const searchOpts = {
    limit: overFetch,
    tag: SESSION_FINDINGS_TAG,
    sessionId,
    vectorLimit: overFetch,
    lexicalLimit: overFetch,
  };
  const findingsRaw = settings.hybridEnabled
    ? await fabric.hybridSearch(embedding, query, searchOpts)
    : await fabric.vectorSearch(embedding, searchOpts);
  const findings = applyScoreGate(findingsRaw, {
    minScore: settings.minScoreMemory * 0.85,
    maxPerSource: 4,
  }).slice(0, 6);
  return packNodes(findings, maxChars, 1);
}

function packNodes(
  nodes: MemoryNode[],
  maxChars: number,
  startIndex: number,
): { text: string; ids: string[]; nextIndex: number } {
  const units: EvidenceUnit[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const u = toEvidenceUnit(nodes[i]!, i);
    if (u) units.push(u);
  }
  const packed = packEvidenceBlocks(units, {
    maxChars,
    maxLineChars: getRetrievalSettings().maxEvidenceLineChars,
    startIndex,
  });
  return {
    text: packed.text,
    ids: packed.evidenceIds,
    nextIndex: startIndex + packed.count,
  };
}

/**
 * Build the memory context block for the system prompt (vector prefetch + grounded packer).
 */
export async function buildMemoryContext(ctx: MemoryContextContext): Promise<{ episodic: string; semantic: string; graph: string; community?: string }> {
  const fabric = ctx.memoryFabric;
  const embedder = ctx.memoryEmbedder;
  if (!fabric || !embedder) return { episodic: '', semantic: '', graph: '' };
  try {
    const lastUser = [...ctx.messages].reverse().find((m) => m.role === 'user');
    const rawQuery = typeof lastUser?.content === 'string' ? lastUser.content : '';
    const memorySessionId = ctx.sessionId;
    const settings = getRetrievalSettings();
    const MAX_CHARS = ctx.usesCompactContext()
      ? settings.maxEvidenceCharsCompact
      : settings.maxEvidenceCharsFull;

    let sessionScopedText = '';
    let sessionScopedIds: string[] = [];
    if (rawQuery && memorySessionId) {
      const sessionPack = await prefetchSessionScopedMemory(
        fabric,
        embedder,
        rawQuery,
        memorySessionId,
        Math.floor(MAX_CHARS * 0.4),
      );
      sessionScopedText = sessionPack.text;
      sessionScopedIds = sessionPack.ids;
    }

    const sessionPrefix = sessionScopedText
      ? `[SESSION RESEARCH — reuse before web_search / deep_web_search / knowledge_base_search]\n${sessionScopedText}\n`
      : '';

    if (!rawQuery) {
      ctx.setMemoryContextNodeIds(sessionScopedIds);
      return { episodic: sessionPrefix.trim(), semantic: '', graph: '' };
    }

    // Fast-path: skip broad retrieval for small-talk — but keep session research above.
    if (!shouldRetrieve(rawQuery, ctx.skipRetrieval)) {
      ctx.setMemoryContextNodeIds(sessionScopedIds);
      return { episodic: sessionPrefix.trim(), semantic: '', graph: '' };
    }

    const t0 = performance.now();
    const query = await ctx.reformulateQuery(rawQuery);
    const tReformulate = performance.now();
    const isSuper = isMemoryFabricSuperSession(memorySessionId, ctx.options.contextKind);
    const result = await vectorMemoryPrefetch(fabric, embedder, query, {
      sessionId: memorySessionId,
      isSuperSession: isSuper,
      vectorLimit: settings.vectorLimit,
      userProfileLimit: isSuper ? settings.userProfileLimit : 0,
      episodicLimit: settings.episodicLimit,
      minRelevance: settings.minScoreMemory,
      speakerId: ctx.speakerId,
    });
    const tPrefetch = performance.now();

    // Reuse the same query embedding for KB chunk search (one embed per turn).
    let chunkNodes: MemoryNode[] = [];
    try {
      const overFetch = Math.max(settings.kbChunkLimit, settings.vectorOverFetch);
      const chunkRaw = settings.hybridEnabled
        ? await fabric.hybridSearch(result.queryEmbedding, query, {
            limit: overFetch,
            category: 'source_doc',
            vectorLimit: overFetch,
            lexicalLimit: overFetch,
          })
        : await fabric.vectorSearch(result.queryEmbedding, {
            limit: overFetch,
            category: 'source_doc',
          });
      chunkNodes = applyScoreGate(chunkRaw, {
        minScore: settings.minScoreKb,
        maxPerSource: settings.maxChunksPerSource,
      });
      if (settings.rerankEnabled) {
        chunkNodes = heuristicRerank(query, chunkNodes);
      }
      chunkNodes = chunkNodes.slice(0, settings.rerankKeep);
      chunkNodes = await expandEvidenceNeighborhood(
        fabric,
        chunkNodes.slice(0, Math.min(settings.kbChunkLimit, settings.graphExpandOnlyOnTopHits)),
        {
          mode: 'order',
          minScore: settings.minScoreKb,
        },
      );
      chunkNodes = applyScoreGate(chunkNodes, {
        minScore: settings.minScoreKb,
        maxPerSource: settings.maxChunksPerSource,
      }).slice(0, Math.min(settings.kbChunkLimit, settings.injectKeep));
    } catch { /* best-effort */ }
    const tKbSearch = performance.now();

    const allNodeIds = new Set(result.all.map((m) => m.id));
    for (const cn of chunkNodes) {
      if (cn.id && !allNodeIds.has(cn.id)) {
        result.vector.push(cn);
        result.all.push(cn);
        allNodeIds.add(cn.id);
      }
    }

    let evidenceIndex = 1;
    const profilePack = packNodes(result.userProfile, Math.floor(MAX_CHARS * 0.30), evidenceIndex);
    evidenceIndex = profilePack.nextIndex;
    const episodicPack = packNodes(result.episodic, Math.floor(MAX_CHARS * 0.25), evidenceIndex);
    evidenceIndex = episodicPack.nextIndex;
    const semanticPack = packNodes(result.vector, Math.floor(MAX_CHARS * 0.45), evidenceIndex);

    const evidenceIds = [...sessionScopedIds, ...profilePack.ids, ...episodicPack.ids, ...semanticPack.ids];
    ctx.setMemoryContextNodeIds(evidenceIds);

    const episodicCombined = [sessionPrefix.trim(), profilePack.text, episodicPack.text].filter(Boolean).join('\n');
    const semanticText = semanticPack.text;

    if (!episodicCombined && !semanticText) {
      getLogger().info('AGENT', 'buildMemoryContext: no evidence above confidence threshold');
      return {
        episodic: '',
        semantic: EMPTY_EVIDENCE_MARKER,
        graph: '',
      };
    }

    getLogger().info(
      'RETRIEVAL_PACK',
      'buildMemoryContext',
      {
        kept: evidenceIds.length,
        userProfile: result.userProfile.length,
        episodic: result.episodic.length,
        semantic: result.vector.length,
        chunks: chunkNodes.length,
        hybrid: settings.hybridEnabled,
        maxChars: MAX_CHARS,
      },
    );

    // Per-phase timing — surfaces bottlenecks regardless of provider.
    const tEnd = performance.now();
    getLogger().info('RETRIEVAL_TIMING', 'buildMemoryContext', {
      reformulateMs: Math.round(tReformulate - t0),
      prefetchMs: Math.round(tPrefetch - tReformulate),
      kbSearchMs: Math.round(tKbSearch - tPrefetch),
      packMs: Math.round(tEnd - tKbSearch),
      totalMs: Math.round(tEnd - t0),
    });

    return {
      episodic: episodicCombined,
      semantic: semanticText,
      graph: '',
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    getLogger().warn('AGENT', `buildMemoryContext failed: ${msg}`);
    ctx.setMemoryContextNodeIds([]);
    return { episodic: '', semantic: '', graph: '' };
  }
}

export interface MemoryExtractionContext {
  config: { autoMemory?: boolean; provider: { activeModel: string } };
  provider: ProviderInterface;
  memoryFabric: MemoryFabric | null;
  memoryEmbedder: EmbeddingProvider | null;
  chatTurnMemoryIngester: ChatTurnMemoryIngester | null;
  setChatTurnMemoryIngester(i: ChatTurnMemoryIngester): void;
  userChatMemoryIngester: UserChatMemoryIngester | null;
  setUserChatMemoryIngester(i: UserChatMemoryIngester): void;
  sessionId: string;
  options: { contextKind?: SessionContextKind };
  speakerId?: string | null;
}

/**
 * Extract memorable facts from the exchange and persist them.
 * Runs asynchronously and silently — never blocks the main flow.
 */
export function extractMemories(
  ctx: MemoryExtractionContext,
  userMessage: string,
  assistantResponse: string,
): void {
  if (ctx.config.autoMemory === false) return;
  const fabric = ctx.memoryFabric;
  const embedder = ctx.memoryEmbedder;
  if (fabric && embedder) {
    let ingester = ctx.chatTurnMemoryIngester;
    if (!ingester) {
      ingester = new ChatTurnMemoryIngester(fabric, embedder);
      ctx.setChatTurnMemoryIngester(ingester);
    }
    const storageSessionId = resolveMemoryFabricWriteSessionId(ctx.sessionId, ctx.options.contextKind);
    void ingester.ingestTurn(
      userMessage,
      assistantResponse,
      ctx.sessionId,
      storageSessionId,
      ctx.speakerId,
    ).catch(() => {});
  }
  // User-profile extraction now runs for every session, not just super-sessions,
  // because user facts are global and highly valuable regardless of where they
  // were stated. Chat-turn memory still follows the session/super rules above.
  if (!fabric || !embedder) return;
  let userIngester = ctx.userChatMemoryIngester;
  if (!userIngester) {
    userIngester = new UserChatMemoryIngester(
      fabric,
      embedder,
      ctx.provider,
      ctx.config.provider.activeModel,
    );
    ctx.setUserChatMemoryIngester(userIngester);
  }
  void userIngester.ingestTurn(userMessage, assistantResponse, ctx.sessionId, ctx.speakerId).catch(() => {});
}

export interface SessionFindingsContext {
  memoryFabric: MemoryFabric | null;
  memoryEmbedder: EmbeddingProvider | null;
  sessionFindingsIngester: SessionFindingsIngester | null;
  setSessionFindingsIngester(i: SessionFindingsIngester): void;
  sessionId: string;
  options: { contextKind?: SessionContextKind };
}

/** Persist successful research tool outputs for cross-turn reuse (always, even in light mode). */
export function persistSessionToolFindings(
  ctx: SessionFindingsContext,
  records: ToolFindingRecord[],
  userQueryHint?: string,
): void {
  const fabric = ctx.memoryFabric;
  const embedder = ctx.memoryEmbedder;
  if (!fabric || !embedder || records.length === 0) return;

  let ingester = ctx.sessionFindingsIngester;
  if (!ingester) {
    ingester = new SessionFindingsIngester(fabric, embedder);
    ctx.setSessionFindingsIngester(ingester);
  }
  const storageSessionId = resolveMemoryFabricWriteSessionId(ctx.sessionId, ctx.options.contextKind);
  void ingester.ingestToolFindings(
    records,
    ctx.sessionId,
    storageSessionId,
    userQueryHint,
  ).catch(() => {});
}

export interface ReformulateQueryContext {
  usesCompactContext(): boolean;
  messages: Array<{ role: string; content: string | unknown }>;
  config: { provider: { activeModel: string } };
  provider: ProviderInterface;
}

/** Per-session LRU cache for reformulated queries (avoids re-calling the LLM for identical follow-ups). */
const REFORMULATE_CACHE = new Map<string, string>();
const REFORMULATE_CACHE_MAX = 8;

/** Pronouns / deictic words that indicate the query needs context to be standalone. */
const DEICTIC_WORDS = new Set([
  'it', 'that', 'this', 'these', 'those', 'they', 'them', 'he', 'she', 'we',
  'here', 'there', 'now', 'then', 'above', 'below', 'same', 'other',
]);

/** Question words that indicate the query is already a standalone question. */
const QUESTION_WORDS = new Set([
  'what', 'how', 'why', 'where', 'when', 'who', 'which', 'whose', 'whom',
]);

/** Hard timeout for the reformulation LLM call — never block the turn for >4s on a 150-token rewrite. */
const REFORMULATE_TIMEOUT_MS = 4_000;

/**
 * Cheap heuristic: if the query is already standalone, skip the LLM call entirely.
 * Returns true if the query does NOT need reformulation.
 */
function isStandaloneQuery(trimmed: string): boolean {
  const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  // Long, punctuated queries are almost always standalone.
  if (wordCount > 30 && /[.!?]$/.test(trimmed)) return true;
  // Questions ending with ? are standalone unless they start with a pronoun.
  if (trimmed.endsWith('?')) {
    const firstWord = words[0] ?? '';
    if (!DEICTIC_WORDS.has(firstWord)) return true;
  }
  // If no deictic words are present and the query is reasonably long, it's standalone.
  if (wordCount >= 5 && !words.some((w) => DEICTIC_WORDS.has(w))) return true;
  // Question-word-starting queries with enough length are standalone.
  if (wordCount >= 4 && QUESTION_WORDS.has(words[0] ?? '')) return true;
  return false;
}

/**
 * Reformulate a user message into a standalone search query using conversation context.
 * Layered optimisation: heuristic short-circuit → LRU cache → LLM call with timeout + no-reasoning.
 */
export async function reformulateQuery(ctx: ReformulateQueryContext, rawQuery: string): Promise<string> {
  const trimmed = rawQuery.trim();
  if (!trimmed) return trimmed;

  // Layer 1: heuristic short-circuit — skip the LLM call entirely for standalone queries.
  if (isStandaloneQuery(trimmed)) return trimmed;

  // Existing compact-context heuristic path (kept for backwards compatibility).
  if (ctx.usesCompactContext()) {
    if (trimmed.length > 80) return trimmed;
    const recentUserMsgs = ctx.messages
      .filter((m) => m.role === 'user' && typeof m.content === 'string' && m.content.trim().length > 20)
      .slice(-3)
      .map((m) => m.content as string);
    if (recentUserMsgs.length > 0 && trimmed.split(/\s+/).length <= 8) {
      return `${recentUserMsgs[recentUserMsgs.length - 1]} ${trimmed}`.trim().slice(0, 300);
    }
    return trimmed;
  }

  // Layer 2: per-session LRU cache — identical follow-ups reuse the last reformulation.
  const cacheKey = `${ctx.config.provider.activeModel}:${trimmed}`;
  const cached = REFORMULATE_CACHE.get(cacheKey);
  if (cached) {
    // Move to end (LRU refresh).
    REFORMULATE_CACHE.delete(cacheKey);
    REFORMULATE_CACHE.set(cacheKey, cached);
    return cached;
  }

  // Existing short-query heuristic (kept for backwards compatibility).
  if (trimmed.split(/\s+/).length <= 3) {
    const recentUserMsgs = ctx.messages
      .filter((m) => m.role === 'user' && typeof m.content === 'string' && m.content.trim().length > 20)
      .slice(-3)
      .map((m) => m.content as string);
    if (recentUserMsgs.length > 0 && trimmed.split(/\s+/).length <= 8) {
      return `${recentUserMsgs[recentUserMsgs.length - 1]} ${trimmed}`.trim().slice(0, 300);
    }
    if (recentUserMsgs.length === 0) return trimmed;
  }

  // Layer 3: LLM call with hard timeout + reasoning_effort: 'none' (no thinking needed for a rewrite).
  try {
    const recentContext = ctx.messages
      .slice(-6)
      .filter((m) => typeof m.content === 'string')
      .map((m) => `${m.role}: ${m.content}`.slice(0, 200))
      .join('\n');
    const prompt = `Rewrite the user's latest message into a standalone search query for a knowledge retrieval system.

Conversation context (most recent first):
${recentContext}

Latest user message: "${rawQuery}"

Rules:
- Output ONLY the reformulated search query, nothing else.
- Incorporate context from the conversation so the query is self-contained.
- If the message is already a clear standalone question, return it as-is.
- Keep it concise (1-2 sentences max).
- Do not add quotes or prefixes.`;
    let reformulated = '';
    const request: CompletionRequest = {
      model: ctx.config.provider.activeModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      maxTokens: 150,
      stream: false,
      reasoningEffort: 'none',
      signal: AbortSignal.timeout(REFORMULATE_TIMEOUT_MS),
    };
    for await (const chunk of ctx.provider.complete(request)) {
      if (chunk.type === 'text_delta' && chunk.content) reformulated += chunk.content;
    }
    const cleaned = reformulated.trim().replace(/^["']|["']$/g, '');
    const result = cleaned || rawQuery;

    // Layer 4: store in LRU cache.
    if (REFORMULATE_CACHE.size >= REFORMULATE_CACHE_MAX) {
      const oldestKey = REFORMULATE_CACHE.keys().next().value;
      if (oldestKey) REFORMULATE_CACHE.delete(oldestKey);
    }
    REFORMULATE_CACHE.set(cacheKey, result);

    return result;
  } catch {
    return rawQuery;
  }
}
