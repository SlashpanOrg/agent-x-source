import { useCallback, useEffect, useState } from 'react';
import type { KnowledgeSource, KnowledgeSourceStatus, KnowledgeSearchResult, UrlScanResult, ScrapeBatchProgress } from '@agentx/shared';
import { knowledgeBase, type KnowledgeSourceEvent } from '../api';

export interface UseKnowledgeBaseReturn {
  sources: KnowledgeSource[];
  loading: boolean;
  error: string | null;
  /** Latest human-readable ingest status line per source (from WS). */
  ingestDetails: Record<string, string>;
  /** Latest batch scrape progress (by batchId). */
  batchProgress: Record<string, ScrapeBatchProgress>;
  refresh: () => Promise<void>;
  getSource: (id: string) => Promise<KnowledgeSource | null>;
  upload: (file: File, sessionId?: string) => Promise<KnowledgeSource>;
  deleteSource: (id: string) => Promise<void>;
  reprocess: (id: string) => Promise<KnowledgeSource>;
  scrape: (url: string, sessionId?: string, follow?: { followLinks?: boolean; maxDepth?: number; maxLinks?: number }) => Promise<KnowledgeSource>;
  scan: (url: string, sessionId?: string, maxLinks?: number) => Promise<UrlScanResult>;
  scrapeRefs: (urls: string[], sessionId?: string, opts?: { maxDepth?: number; maxLinks?: number; rootUrl?: string }) => Promise<string>;
  pauseBatch: (batchId: string) => Promise<void>;
  resumeBatch: (batchId: string) => Promise<void>;
  cancelBatch: (batchId: string) => Promise<void>;
  rescrape: (id: string) => Promise<{ source: KnowledgeSource; action: 'skipped' | 'updated' | 'unavailable' }>;
  pause: (id: string) => Promise<KnowledgeSource>;
  resume: (id: string) => Promise<KnowledgeSource>;
  search: (query: string, topK?: number, kind?: 'all' | 'chunk' | 'page', sourceId?: string) => Promise<KnowledgeSearchResult[]>;
  clearSearch: () => void;
  searchResults: KnowledgeSearchResult[];
  searching: boolean;
}

export function useKnowledgeBase(sessionId?: string): UseKnowledgeBaseReturn {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<KnowledgeSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [ingestDetails, setIngestDetails] = useState<Record<string, string>>({});
  const [batchProgress, setBatchProgress] = useState<Record<string, ScrapeBatchProgress>>({});

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) setLoading(true);
      const list = await knowledgeBase.list(sessionId);
      setSources(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [sessionId]);

  const getSource = useCallback(async (id: string) => {
    try {
      return await knowledgeBase.get(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, []);

  const upload = useCallback(async (file: File, sessionId?: string) => {
    const source = await knowledgeBase.upload(file, sessionId);
    setSources((prev) => {
      const filtered = prev.filter((s) => s.id !== source.id);
      return [source, ...filtered];
    });
    return source;
  }, []);

  const deleteSource = useCallback(async (id: string) => {
    await knowledgeBase.delete(id);
    setSources((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const reprocess = useCallback(async (id: string) => {
    const source = await knowledgeBase.reprocess(id);
    setSources((prev) =>
      prev.map((s) =>
        s.id === source.id
          ? { ...source, error: undefined, status: source.status ?? 'pending', progress: source.progress ?? 0 }
          : s,
      ),
    );
    return source;
  }, []);

  const scrape = useCallback(async (url: string, sessionId?: string, follow?: { followLinks?: boolean; maxDepth?: number; maxLinks?: number }) => {
    const source = await knowledgeBase.scrape(url, sessionId, follow);
    setSources((prev) => {
      const filtered = prev.filter((s) => s.id !== source.id);
      return [source, ...filtered];
    });
    return source;
  }, []);

  const scan = useCallback(async (url: string, sessionId?: string, maxLinks?: number) => {
    return await knowledgeBase.scan(url, sessionId, maxLinks);
  }, []);

  const scrapeRefs = useCallback(async (urls: string[], sessionId?: string, opts?: { maxDepth?: number; maxLinks?: number; rootUrl?: string }) => {
    const result = await knowledgeBase.scrapeRefs(urls, sessionId, opts);
    return result.batchId;
  }, []);

  const pauseBatch = useCallback(async (batchId: string) => {
    await knowledgeBase.pauseBatch(batchId);
  }, []);

  const resumeBatch = useCallback(async (batchId: string) => {
    await knowledgeBase.resumeBatch(batchId);
  }, []);

  const cancelBatch = useCallback(async (batchId: string) => {
    await knowledgeBase.cancelBatch(batchId);
  }, []);

  const rescrape = useCallback(async (id: string) => {
    const { source, action } = await knowledgeBase.rescrape(id);
    setSources((prev) =>
      prev.map((s) => (s.id === source.id ? source : s)),
    );
    return { source, action };
  }, []);

  const pause = useCallback(async (id: string) => {
    const source = await knowledgeBase.pause(id);
    setSources((prev) =>
      prev.map((s) => (s.id === source.id ? source : s)),
    );
    return source;
  }, []);

  const resume = useCallback(async (id: string) => {
    const source = await knowledgeBase.resume(id);
    setSources((prev) =>
      prev.map((s) => (s.id === source.id ? source : s)),
    );
    return source;
  }, []);

  const search = useCallback(async (query: string, topK = 5, kind: 'all' | 'chunk' | 'page' = 'all', sourceId?: string) => {
    setSearching(true);
    try {
      const results = await knowledgeBase.search(query, topK, kind, sourceId);
      setSearchResults(results);
      return results;
    } finally {
      setSearching(false);
    }
  }, []);

  const clearSearch = useCallback(() => {
    setSearchResults([]);
  }, []);

  // Initial load + poll only while tab visible (WS covers live status).
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.hidden) return;
      void refresh({ silent: true });
    }, 30000);
    return () => clearInterval(timer);
  }, [refresh]);

  // WebSocket status subscription — patch by id without cloning when unchanged.
  useEffect(() => {
    const patchSource = (
      id: string,
      patch: Partial<KnowledgeSource>,
      opts?: { refreshIfMissing?: boolean },
    ) => {
      setSources((prev) => {
        const idx = prev.findIndex((s) => s.id === id);
        if (idx < 0) {
          if (opts?.refreshIfMissing) void refresh();
          return prev;
        }
        const cur = prev[idx]!;
        const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
        if (
          cur.status === next.status
          && cur.progress === next.progress
          && cur.error === next.error
        ) {
          return prev;
        }
        const copy = prev.slice();
        copy[idx] = next;
        return copy;
      });
    };

    const handleEvent = (event: KnowledgeSourceEvent) => {
      if (event.type === 'knowledge_base_source_status') {
        if (event.detail) {
          setIngestDetails((prev) => {
            if (prev[event.sourceId] === event.detail) return prev;
            return { ...prev, [event.sourceId]: event.detail! };
          });
        }
        patchSource(
          event.sourceId,
          {
            status: event.status as KnowledgeSourceStatus,
            progress: event.progress,
            error:
              event.status === 'failed'
                ? (event.error ?? undefined)
                : event.error !== undefined
                  ? event.error
                  : undefined,
          },
          { refreshIfMissing: true },
        );
      } else if (event.type === 'knowledge_base_source_ready') {
        setIngestDetails((prev) => {
          const line = 'Intel package indexed and online.';
          if (prev[event.sourceId] === line) return prev;
          return { ...prev, [event.sourceId]: line };
        });
        void refresh({ silent: true });
        patchSource(event.sourceId, {
          status: 'ready',
          progress: 100,
          error: undefined,
        });
      } else if (event.type === 'knowledge_base_source_failed') {
        setIngestDetails((prev) => {
          const line = event.error || 'Ingest failed.';
          if (prev[event.sourceId] === line) return prev;
          return { ...prev, [event.sourceId]: line };
        });
        patchSource(
          event.sourceId,
          { status: 'failed', error: event.error },
          { refreshIfMissing: true },
        );
      } else if (event.type === 'knowledge_base_scrape_batch_progress') {
        const p: ScrapeBatchProgress = {
          batchId: event.batchId,
          total: event.total,
          completed: event.completed,
          currentIndex: event.currentIndex,
          currentUrl: event.currentUrl,
          succeeded: event.succeeded,
          failed: event.failed,
          status: event.status as ScrapeBatchProgress['status'],
          sourceIds: event.sourceIds,
        };
        setBatchProgress((prev) => ({ ...prev, [p.batchId]: p }));
        // Auto-refresh source list when batch is done
        if (p.status === 'done' || p.status === 'paused') {
          void refresh({ silent: true });
        }
      }
    };

    const close = knowledgeBase.subscribe(handleEvent);
    return close;
  }, [refresh]);

  return {
    sources,
    loading,
    error,
    ingestDetails,
    batchProgress,
    refresh,
    getSource,
    upload,
    deleteSource,
    reprocess,
    scrape,
    scan,
    scrapeRefs,
    pauseBatch,
    resumeBatch,
    cancelBatch,
    rescrape,
    pause,
    resume,
    search,
    clearSearch,
    searchResults,
    searching,
  };
}
