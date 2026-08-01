/** Lifecycle states for a knowledge source ingestion job. */
export type KnowledgeSourceStatus =
  | 'pending'
  | 'extracting'
  | 'chunking'
  | 'embedding'
  | 'indexing'
  | 'graphing'
  | 'ready'
  | 'failed';

/** Scrape-specific status for URL sources (stored in scrape_status column). */
export type ScrapeStatus = 'fresh' | 'unchanged' | 'updated' | 'unavailable' | 'error' | 'paused';

/** A document/file that has been uploaded into the knowledge base. */
export interface KnowledgeSource {
  id: string;
  /** Optional session/tenant scoping. */
  sessionId?: string;
  /** Original file name. */
  name: string;
  mimeType: string;
  size: number;
  /** Reference into AttachmentService / file storage. */
  storageId: string;
  status: KnowledgeSourceStatus;
  /** 0-100 progress, derived from the current pipeline stage. */
  progress: number;
  error?: string;
  /** Auto-generated short summary, available after indexing. */
  summary?: string;
  chunkCount?: number;
  pageCount?: number;
  /** 1-based position in the ingest queue when status is pending. */
  queuePosition?: number;
  /** Source URL for website-scraped sources. */
  sourceUrl?: string;
  /** SHA-256 hash of extracted content, for smart rescrape comparison. */
  contentHash?: string;
  /** Last successful scrape timestamp (ISO string). */
  lastScrapedAt?: string;
  /** Scrape-specific status for URL sources. */
  scrapeStatus?: ScrapeStatus;
  /** Parent source id when this source was scraped as a followed reference/child link. */
  parentId?: string;
  createdAt: string;
  updatedAt: string;
}

/** A searchable chunk of a knowledge source. */
export interface KnowledgeChunk {
  id: string;
  sourceId: string;
  /** Position within the document. */
  index: number;
  content: string;
  /** Optional vector embedding; stored as JSONB when pgvector is unavailable. */
  embedding?: number[];
  /** Source/page/heading metadata. */
  metadata?: Record<string, unknown>;
}

/** A single page of a paginated knowledge source (e.g. PDF slide). */
export interface KnowledgePage {
  id: string;
  sourceId: string;
  pageNumber: number;
  /** Raw or cleaned text for the page. */
  content: string;
  /** LLM summary of the page, generated during indexing. */
  summary?: string;
  embedding?: number[];
  /** Original filename; stored in vector metadata for search display. */
  sourceName?: string;
}

/** Result returned by a knowledge-base search. */
export interface KnowledgeSearchResult {
  id: string;
  content: string;
  sourceId: string;
  sourceName: string;
  /** 0-1 relevance score. */
  score: number;
  kind: 'chunk' | 'page' | 'entity' | 'summary';
  metadata?: Record<string, unknown>;
}

/** Payload used to create a new knowledge source. */
export interface CreateKnowledgeSourceInput {
  name: string;
  mimeType: string;
  size: number;
  storageId: string;
  sessionId?: string;
  /** Source URL for website-scraped sources. */
  sourceUrl?: string;
  /** Content hash for smart rescrape comparison. */
  contentHash?: string;
  /** Parent source id for followed reference/child scrapes. */
  parentId?: string;
  /** Origin code — defaults to documentUpload if not specified. */
  origin?: string;
}

/** Client request to search the knowledge base. */
export interface KnowledgeSearchRequest {
  query: string;
  topK?: number;
  kind?: 'chunk' | 'page' | 'all';
  /** Limit search to a single source. */
  sourceId?: string;
}

/** Client response for a knowledge source list. */
export interface KnowledgeSourceListResponse {
  sources: KnowledgeSource[];
}

/** A discovered reference link from a URL scan. */
export interface ScannedReference {
  url: string;
  /** Relevance score from the link scoring algorithm. */
  score: number;
  /** Link text or URL-derived title. */
  title: string;
  /** Hostname of the link target. */
  host: string;
  /** Whether the link is on the same domain as the root URL. */
  sameHost: boolean;
  /** Whether the link is a known reference host (doi.org, ncbi, etc). */
  isReferenceHost: boolean;
  /** Category: reference, pagination, sequential, external, doi. */
  category: 'reference' | 'pagination' | 'sequential' | 'external' | 'doi';
}

/** Result of scanning a URL for reference links (no ingestion). */
export interface UrlScanResult {
  /** The root URL that was scanned. */
  url: string;
  /** All discovered reference links, sorted by score descending. */
  references: ScannedReference[];
  /** Number of chars extracted from the root page. */
  contentLength: number;
  /** Page title from the extractor. */
  title: string;
  /** Which fetch method succeeded. */
  fetchMethod: string;
}

/** Progress event for a batch reference scrape operation. */
export interface ScrapeBatchProgress {
  /** Unique batch ID for this scrape operation. */
  batchId: string;
  /** Total URLs to scrape. */
  total: number;
  /** Completed (success or fail). */
  completed: number;
  /** Currently being scraped (1-based index). */
  currentIndex: number;
  /** URL currently being scraped. */
  currentUrl: string;
  /** Number that succeeded. */
  succeeded: number;
  /** Number that failed. */
  failed: number;
  /** Status: running, done, paused. */
  status: 'running' | 'done' | 'paused';
  /** Source IDs created so far. */
  sourceIds: string[];
}
