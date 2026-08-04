import type { EmbeddingProvider } from '@agentx/shared';
import type { MemoryFabric, MemoryNode } from './MemoryFabric.js';
import { CHAT_MEMORY_TAG } from './ChatTurnMemoryIngester.js';
import { USER_PROFILE_TAG } from './UserChatMemoryIngester.js';
import {
  applyScoreGate,
  heuristicRerank,
  expandEvidenceNeighborhood,
  getRetrievalSettings,
} from './retrieval/index.js';

export interface VectorMemoryPrefetchOptions {
  sessionId: string;
  isSuperSession: boolean;
  vectorLimit?: number;
  userProfileLimit?: number;
  episodicLimit?: number;
  minRelevance?: number;
  /** Precomputed query embedding — avoids a second embed() in the same turn. */
  queryEmbedding?: number[];
  /** Skip graph expand (tests / nested calls). */
  skipExpand?: boolean;
  /** Voice speaker id to boost (not filter) matching provenance in results. */
  speakerId?: string | null;
}

export interface VectorMemoryPrefetchResult {
  vector: MemoryNode[];
  episodic: MemoryNode[];
  userProfile: MemoryNode[];
  all: MemoryNode[];
  queryEmbedding: number[];
}

async function retrieveCandidates(
  fabric: MemoryFabric,
  embedding: number[],
  query: string,
  options: {
    limit: number;
    overFetch: number;
    category?: MemoryNode['category'];
    tag?: string;
    sessionId?: string | null;
  },
): Promise<MemoryNode[]> {
  const settings = getRetrievalSettings();
  const searchOpts = {
    limit: options.overFetch,
    category: options.category,
    tag: options.tag,
    sessionId: options.sessionId,
    vectorLimit: options.overFetch,
    lexicalLimit: options.overFetch,
  };
  if (settings.hybridEnabled) {
    return fabric.hybridSearch(embedding, query, searchOpts);
  }
  return fabric.vectorSearch(embedding, searchOpts);
}

export async function vectorMemoryPrefetch(
  fabric: MemoryFabric,
  embedder: EmbeddingProvider,
  query: string,
  options: VectorMemoryPrefetchOptions,
): Promise<VectorMemoryPrefetchResult> {
  const settings = getRetrievalSettings();
  const vectorLimit = options.vectorLimit ?? settings.vectorLimit;
  const userProfileLimit = options.userProfileLimit ?? settings.userProfileLimit;
  const episodicLimit = options.episodicLimit ?? settings.episodicLimit;
  const minRelevance = options.minRelevance ?? settings.minScoreMemory;
  const rerankKeep = settings.rerankKeep;
  const injectKeep = settings.injectKeep;
  const overFetch = Math.max(vectorLimit, settings.vectorOverFetch, rerankKeep);
  const isSuper = options.isSuperSession;

  const embedding = options.queryEmbedding ?? await embedder.embed(query);

  const gate = (nodes: MemoryNode[]) =>
    applyScoreGate(nodes, {
      minScore: minRelevance,
      maxPerSource: settings.maxChunksPerSource,
    });

  /** Gate → optional rerank → keep ≤ rerankKeep (caller may tighten further). */
  const rankKeep = (nodes: MemoryNode[], keep: number) => {
    let next = gate(nodes);
    if (settings.rerankEnabled) next = heuristicRerank(query, next);
    return next.slice(0, Math.min(keep, rerankKeep));
  };

  /** Boost matching speaker nodes to the top without removing any candidate. */
  function boostSpeakerMatches(nodes: MemoryNode[], speaker?: string | null): MemoryNode[] {
    if (!speaker) return nodes;
    return [...nodes].sort((a, b) => {
      const aMatch = a.provenance?.speakerId === speaker ? 1 : 0;
      const bMatch = b.provenance?.speakerId === speaker ? 1 : 0;
      return bMatch - aMatch;
    });
  }

  const speakerId = options.speakerId;

  let vector = boostSpeakerMatches(
    rankKeep(
      await retrieveCandidates(fabric, embedding, query, {
        limit: vectorLimit,
        overFetch,
        ...(isSuper ? {} : { sessionId: options.sessionId }),
      }),
      vectorLimit,
    ),
    speakerId,
  );

  if (!options.skipExpand && vector.length) {
    vector = boostSpeakerMatches(
      rankKeep(
        await expandEvidenceNeighborhood(fabric, vector, {
          mode: 'both',
          minScore: minRelevance,
        }),
        vectorLimit,
      ),
      speakerId,
    ).slice(0, injectKeep);
  } else {
    vector = vector.slice(0, injectKeep);
  }

  const userProfileRaw = isSuper
    ? await retrieveCandidates(fabric, embedding, query, {
        limit: userProfileLimit,
        overFetch: Math.max(userProfileLimit, overFetch),
        tag: USER_PROFILE_TAG,
        sessionId: null,
      })
    : [];
  const userProfile = boostSpeakerMatches(
    rankKeep(userProfileRaw, userProfileLimit).slice(0, Math.min(userProfileLimit, injectKeep)),
    speakerId,
  );

  let episodic: MemoryNode[] = [];
  if (options.sessionId) {
    const assembled = await fabric.assembleContext(options.sessionId, embedding, {
      episodicLimit,
      semanticLimit: 0,
      graphDepth: 0,
    });
    episodic = boostSpeakerMatches(assembled.episodic.slice(0, episodicLimit), speakerId);
  }

  // Super sessions can also search chat_memory globally (session-scoped NULL) so the
  // agent can recall exact prior turns, not just extracted user-profile facts.
  const chatScopedRaw = await retrieveCandidates(fabric, embedding, query, {
    limit: vectorLimit,
    overFetch,
    tag: CHAT_MEMORY_TAG,
    sessionId: isSuper ? null : options.sessionId,
  });
  const chatScoped = boostSpeakerMatches(
    rankKeep(chatScopedRaw, vectorLimit).slice(0, injectKeep),
    speakerId,
  );

  const seen = new Set<string>();
  const all: MemoryNode[] = [];
  for (const node of [...userProfile, ...episodic, ...chatScoped, ...vector]) {
    if (!node.id || seen.has(node.id)) continue;
    seen.add(node.id);
    all.push(node);
  }

  return { vector, episodic, userProfile, all, queryEmbedding: embedding };
}
