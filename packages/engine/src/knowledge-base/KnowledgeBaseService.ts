import type { Pool } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { getLogger, KnowledgeBaseOrigin, type CreateKnowledgeSourceInput, type KnowledgeSearchResult, type KnowledgeSource, type ScannedReference, type UrlScanResult, type ScrapeBatchProgress } from '@agentx/shared';
import { getAttachmentService } from '../attachments/index.js';
import type { MemoryFabric } from '../neural/MemoryFabric.js';
import { getEmbedderInstance, OnnxEmbeddingProvider } from '../neural/OnnxEmbeddingProvider.js';
import { resolveEmbedTextForNode } from '../neural/retrieval/contextualize.js';
import { toHalfvecLiteral } from '../neural/VectorQuantizer.js';
import { hybridFetchAndExtract } from '../search/hybrid-extract.js';
import { DocumentIngestPipeline } from './DocumentIngestPipeline.js';
import { searchKnowledgeBaseDocuments } from './document-search.js';
import { KnowledgeBaseSourceStore } from './KnowledgeBaseSourceStore.js';

export type KnowledgeBaseStatusListener = (
  sourceId: string,
  status: KnowledgeSource['status'],
  progress: number,
  detail?: string,
  error?: string,
) => void;

export type ScrapeBatchProgressListener = (progress: ScrapeBatchProgress) => void;

export interface KnowledgeBaseServiceOptions {
  pool: Pool;
  fabric: MemoryFabric;
  embedder?: OnnxEmbeddingProvider;
}

interface ScrapeJob {
  rootId: string;
  sessionId?: string;
  opts: { followLinks: boolean; maxDepth: number; maxLinks: number };
  visited: Set<string>;
  paused: boolean;
  pending: Array<{ url: string; parentId: string; depthLeft: number }>;
  domainFailures: Map<string, number>;
}

export class KnowledgeBaseService {
  private pool: Pool;
  private fabric: MemoryFabric;
  private embedder?: OnnxEmbeddingProvider;
  private sourceStore: KnowledgeBaseSourceStore;
  private logger = getLogger();
  private statusListeners = new Set<KnowledgeBaseStatusListener>();
  private batchProgressListeners = new Set<ScrapeBatchProgressListener>();
  private queue: string[] = [];
  private processing = false;
  private scrapeJobs = new Map<string, ScrapeJob>();
  private batchScrapes = new Map<string, { cancelled: boolean; paused: boolean }>();

  constructor(opts: KnowledgeBaseServiceOptions) {
    this.pool = opts.pool;
    this.fabric = opts.fabric;
    this.embedder = opts.embedder;
    this.sourceStore = new KnowledgeBaseSourceStore(opts.pool);
  }

  onStatusChange(listener: KnowledgeBaseStatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onBatchProgress(listener: ScrapeBatchProgressListener): () => void {
    this.batchProgressListeners.add(listener);
    return () => this.batchProgressListeners.delete(listener);
  }

  private emitBatchProgress(p: ScrapeBatchProgress): void {
    for (const listener of this.batchProgressListeners) {
      try { listener(p); } catch { /* ignore */ }
    }
  }

  private emitStatus(
    sourceId: string,
    status: KnowledgeSource['status'],
    progress: number,
    detail?: string,
    error?: string,
  ): void {
    for (const listener of this.statusListeners) {
      try {
        listener(sourceId, status, progress, detail, error);
      } catch (err) {
        this.logger.warn('KB_STATUS_LISTENER', 'Listener failed', { sourceId, error: (err as Error).message });
      }
    }
  }

  private getEmbedder(): OnnxEmbeddingProvider {
    if (this.embedder) return this.embedder;
    const existing = getEmbedderInstance();
    if (existing) {
      this.embedder = existing;
      return existing;
    }
    const fresh = new OnnxEmbeddingProvider();
    this.embedder = fresh;
    return fresh;
  }

  async uploadSource(buffer: Buffer, filename: string, mimeType: string, sessionId?: string): Promise<KnowledgeSource> {
    const attachment = await getAttachmentService().saveFromBuffer(
      sessionId ?? 'global',
      filename,
      buffer,
      mimeType,
      'upload',
    );
    return this.sourceStore.insertSource({
      name: filename,
      mimeType,
      size: buffer.length,
      storageId: attachment.id,
      sessionId,
    } satisfies CreateKnowledgeSourceInput);
  }

  getQueuePosition(sourceId: string): number | undefined {
    const idx = this.queue.indexOf(sourceId);
    return idx >= 0 ? idx + 1 : undefined;
  }

  enqueueProcess(sourceId: string): void {
    if (!this.queue.includes(sourceId)) {
      this.queue.push(sourceId);
    }
    void this.drainQueue();
  }

  async processSource(sourceId: string): Promise<void> {
    const source = await this.sourceStore.getSource(sourceId);
    if (!source) throw new Error(`Knowledge base source not found: ${sourceId}`);

    await this.sourceStore.updateSource(sourceId, { status: 'pending', progress: 0, error: null });
    this.emitStatus(sourceId, 'pending', 0, 'queued');

    const pipeline = new DocumentIngestPipeline({
      fabric: this.fabric,
      sourceStore: this.sourceStore,
      embedder: this.getEmbedder(),
      onStatus: (id, status, progress, detail, error) => {
        this.emitStatus(id, status, progress, detail, error);
      },
    });

    await pipeline.process(source, false);
  }

  private async drainQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const sourceId = this.queue.shift();
        if (!sourceId) continue;
        try {
          await this.processSource(sourceId);
        } catch {
          /* errors persisted on source row */
        }
      }
    } finally {
      this.processing = false;
    }
  }

  async search(query: string, topK = 5, sourceId?: string): Promise<KnowledgeSearchResult[]> {
    const sourceIds = sourceId ? await this.sourceStore.getDescendantSourceIds(sourceId) : undefined;
    return searchKnowledgeBaseDocuments(this.fabric, this.getEmbedder(), this.sourceStore, query, topK, sourceIds);
  }

  async listSources(sessionId?: string): Promise<KnowledgeSource[]> {
    const sources = await this.sourceStore.listSources(sessionId);
    return sources.map((source) => {
      const queuePosition = this.getQueuePosition(source.id);
      return queuePosition != null ? { ...source, queuePosition } : source;
    });
  }

  async getSource(id: string): Promise<KnowledgeSource | null> {
    return this.sourceStore.getSource(id);
  }

  async listIngestEvents(sourceId: string) {
    return this.sourceStore.listIngestEvents(sourceId);
  }

  async deleteSource(id: string): Promise<void> {
    await this.fabric.pruneSource(id);
    await this.sourceStore.deleteSource(id);
  }

  async reprocessSource(id: string): Promise<void> {
    const source = await this.sourceStore.getSource(id);
    if (!source) throw new Error(`Knowledge base source not found: ${id}`);
    await this.pool.query(
      `UPDATE memory_sources SET origin = $1, status = 'pending', progress = 0, error = NULL, updated_at = NOW() WHERE id = $2::uuid`,
      [KnowledgeBaseOrigin.documentReprocess, id],
    );
    this.emitStatus(id, 'pending', 0, 'reprocess');
    this.enqueueProcess(id);
  }

  /**
   * Re-embed existing chunk nodes for a source using stored provenance.embedText
   * (or rebuilt heading path) without re-parsing the original file.
   */
  async reEmbedSource(id: string, batchSize = 32): Promise<{ updated: number; failed: number }> {
    const source = await this.sourceStore.getSource(id);
    if (!source) throw new Error(`Knowledge base source not found: ${id}`);
    const embedder = this.getEmbedder();
    this.emitStatus(id, 'embedding', 10, 're-embed (no re-parse)');

    const { nodes } = await this.fabric.getNodesBySource(id, { limit: 10_000, category: 'source_doc' });
    const chunks = nodes.filter((n) => n.unitType === 'chunk' || (!n.unitType && n.content));
    let updated = 0;
    let failed = 0;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map((n) =>
        resolveEmbedTextForNode({
          content: n.content,
          label: n.label,
          headingPath: n.headingPath,
          provenance: n.provenance,
        }),
      );
      try {
        const embeddings = await embedder.embedBatch(texts);
        for (let j = 0; j < batch.length; j++) {
          const node = batch[j]!;
          const embedding = embeddings[j];
          if (!embedding?.length) {
            failed++;
            continue;
          }
          await this.pool.query(
            `UPDATE memory_nodes
                SET embedding = $1::vector,
                    embedding_halfvec = $2::halfvec,
                    updated_at = NOW()
              WHERE id = $3`,
            [`[${embedding.join(',')}]`, toHalfvecLiteral(embedding), node.id],
          );
          updated++;
        }
      } catch (err) {
        this.logger.warn('KB_RE_EMBED', 'Batch re-embed failed', {
          sourceId: id,
          error: (err as Error).message,
        });
        failed += batch.length;
      }
      const progress = 10 + Math.floor(((i + batch.length) / Math.max(chunks.length, 1)) * 85);
      this.emitStatus(id, 'embedding', progress, `Re-embedded ${Math.min(i + batch.length, chunks.length)}/${chunks.length}`);
    }

    this.emitStatus(id, 'ready', 100, `Re-embedded ${updated} chunks (failed=${failed})`);
    return { updated, failed };
  }

  /**
   * Scrape a website URL and ingest its content into the knowledge base.
   * Uses the hybrid extractor (trafilatura + agent-fetch) for accurate content.
   *
   * Optionally follows reference/consecutive links as child sources.
   * Follows are processed in a background queue so the root can be returned quickly.
   * The queue pauses automatically if repeated server restrictions are detected.
   */
  async scrapeSource(
    url: string,
    sessionId?: string,
    follow: { followLinks?: boolean; maxDepth?: number; maxLinks?: number; parentId?: string } = {},
  ): Promise<KnowledgeSource> {
    const opts = {
      followLinks: follow.followLinks ?? false,
      maxDepth: Math.max(0, Math.min(follow.maxDepth ?? 0, 10)),
      maxLinks: Math.max(0, Math.min(follow.maxLinks ?? 0, 250)),
    };
    const parentId = follow.parentId;

    const root = await this.scrapeOne(url, sessionId, parentId);

    const job: ScrapeJob = {
      rootId: root.id,
      sessionId,
      opts,
      visited: new Set<string>([url]),
      paused: false,
      pending: [],
      domainFailures: new Map(),
    };
    this.scrapeJobs.set(root.id, job);

    // enqueue any immediate children the root found
    if (opts.followLinks && opts.maxDepth > 0 && opts.maxLinks > 0) {
      const childUrls = this.selectReferenceLinks(root.links ?? [], url, opts.maxLinks, job.visited);
      for (const childUrl of childUrls) {
        if (!job.visited.has(childUrl)) {
          job.visited.add(childUrl);
          job.pending.push({ url: childUrl, parentId: root.id, depthLeft: opts.maxDepth - 1 });
        }
      }
    }

    void this.processQueue(root.id);
    return root;
  }

  private async processQueue(rootId: string): Promise<void> {
    const job = this.scrapeJobs.get(rootId);
    if (!job) return;

    while (!job.paused && job.pending.length > 0) {
      const task = job.pending.shift();
      if (!task) continue;
      if (job.visited.has(task.url)) continue;
      job.visited.add(task.url);

      try {
        const source = await this.scrapeOne(task.url, job.sessionId, task.parentId);
        if (job.paused) continue;

        // enqueue this source's own references with one less depth level
        if (task.depthLeft > 0 && job.opts.maxLinks > 0) {
          const childUrls = this.selectReferenceLinks(source.links ?? [], task.url, job.opts.maxLinks, job.visited);
          for (const childUrl of childUrls) {
            if (!job.visited.has(childUrl)) {
              job.visited.add(childUrl);
              job.pending.push({ url: childUrl, parentId: source.id, depthLeft: task.depthLeft - 1 });
            }
          }
        }
      } catch (err) {
        const domain = this.extractDomain(task.url);
        const isRestricted = this.isRestrictedError(err);
        const count = (job.domainFailures.get(domain) ?? 0) + (isRestricted ? 1 : 0);
        job.domainFailures.set(domain, isRestricted ? count : 0);

        if (isRestricted && count >= 2) {
          this.logger.warn('KB_SCRAPE_PAUSED', `Domain ${domain} restricted — pausing follow queue`, { rootId });
          job.paused = true;
          await this.sourceStore.updateSource(rootId, { scrapeStatus: 'paused' });
          this.emitStatus(rootId, 'pending', 0, `Domain restricted: ${domain} — follow queue paused. Resume to continue.`);
          break;
        }

        this.logger.warn('KB_FOLLOW_LINK', `Failed to follow ${task.url}`, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (!job.paused && job.pending.length === 0) {
      this.scrapeJobs.delete(rootId);
    }
  }

  private async scrapeOne(
    url: string,
    sessionId: string | undefined,
    parentId: string | undefined,
  ): Promise<KnowledgeSource & { links: string[] }> {
    const isChild = parentId != null;

    const result = await hybridFetchAndExtract(url);
    const httpStatus = this.parseHttpStatus(result.reason);
    const content = result.markdown || result.text;
    if (!content.trim()) {
      if (httpStatus && httpStatus >= 400) {
        throw new Error(`HTTP ${httpStatus} — no content extracted from ${url}`);
      }
      throw new Error(`No content extracted from ${url}`);
    }

    // SHA-256 hash for smart rescrape comparison
    const contentHash = createHash('sha256').update(content).digest('hex');
    const title = result.title || new URL(url).hostname;
    const filename = `${title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)}.md`;

    // Save content as an attachment (markdown file)
    const attachment = await getAttachmentService().saveFromBuffer(
      sessionId ?? 'global',
      filename,
      Buffer.from(content, 'utf-8'),
      'text/markdown',
      'scrape',
    );

    // Create the source row with URL + hash + parent
    const source = await this.sourceStore.insertSource({
      name: title,
      mimeType: 'text/markdown',
      size: Buffer.byteLength(content, 'utf-8'),
      storageId: attachment.id,
      sessionId,
      sourceUrl: url,
      contentHash,
      parentId,
      origin: isChild ? KnowledgeBaseOrigin.websiteScrapeChild : KnowledgeBaseOrigin.websiteScrape,
    } satisfies CreateKnowledgeSourceInput);

    // Update scrape timestamp
    await this.sourceStore.updateSource(source.id, {
      lastScrapedAt: new Date().toISOString(),
      scrapeStatus: 'fresh',
    });

    this.emitStatus(source.id, 'pending', 0, isChild ? 'Reference scraped — queued for ingestion' : 'Scrape complete — queued for ingestion');
    this.enqueueProcess(source.id);

    return { ...source, links: result.links };
  }

  /** Pause a running scrape job. */
  async pauseScrape(rootId: string): Promise<void> {
    const job = this.scrapeJobs.get(rootId);
    if (!job) return;
    job.paused = true;
    await this.sourceStore.updateSource(rootId, { scrapeStatus: 'paused' });
    this.emitStatus(rootId, 'pending', 0, 'Follow queue paused by user.');
  }

  /** Resume a paused scrape job from where it left off. */
  async resumeScrape(rootId: string): Promise<void> {
    const job = this.scrapeJobs.get(rootId);
    if (!job) {
      // if no in-memory job, just reset status so it can be rescraped manually
      const source = await this.sourceStore.getSource(rootId);
      if (source) {
        await this.sourceStore.updateSource(rootId, { scrapeStatus: 'fresh' });
      }
      return;
    }
    job.paused = false;
    await this.sourceStore.updateSource(rootId, { scrapeStatus: 'fresh' });
    this.emitStatus(rootId, 'pending', 0, 'Resuming follow queue…');
    void this.processQueue(rootId);
  }

  private extractDomain(url: string): string {
    try { return new URL(url).hostname; } catch { return url; }
  }

  private parseHttpStatus(reason: string): number | null {
    const m = reason.match(/HTTP\s+(\d{3})/);
    return m ? Number(m[1]) : null;
  }

  private isRestrictedError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    const code = msg.match(/\b(403|429|503)\b/)?.[0];
    return code === '403' || code === '429' || code === '503' || /forbidden|rate.?limit|unauthorized/i.test(msg);
  }

  private selectReferenceLinks(links: string[], baseUrl: string, maxLinks: number, visited: Set<string>): string[] {
    return this.scoreReferenceLinks(links, baseUrl, visited)
      .slice(0, maxLinks)
      .map((s) => s.url);
  }

  /** Score and categorize all reference links from a page. Returns sorted by score descending. */
  private scoreReferenceLinks(links: string[], baseUrl: string, visited?: Set<string>): ScannedReference[] {
    const base = (() => { try { return new URL(baseUrl); } catch { return null; } })();
    if (!base) return [];

    const excludedPathParts = new Set(['tag', 'author', 'category', 'archive', 'search', 'feed', 'rss', 'wp-json', 'wp-content', 'login', 'register', 'cart', 'checkout', 'account', 'shop', 'store', 'about', 'contact', 'myncbi', 'disclaimer', 'signout']);
    const excludedKeywords = new Set(['related', 'recommended', 'sponsored', 'popular', 'trending', 'latest', 'newsletter', 'subscribe', 'share', 'comment', 'login', 'register', 'cart', 'checkout', 'signin', 'signup']);
    const paginationKeywords = new Set(['page', 'p', 'offset', 'start', 'index', 'pg']);
    const referenceKeywords = new Set(['ref', 'reference', 'references', 'bibliography', 'citation', 'citations', 'note', 'notes', 'footnote', 'footnotes', 'appendix', 'supplementary', 'additional']);
    const sequentialKeywords = new Set(['part', 'chapter', 'section', 'step', 'next', 'prev', 'previous', 'continued', 'consecutive', 'page', 'episode']);
    const badExtensions = new Set(['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'mp4', 'mp3', 'zip', 'tar', 'gz', 'doc', 'docx', 'xls', 'xlsx', 'css', 'js', 'xml', 'ico', 'woff', 'woff2', 'ttf', 'eot', 'otf', 'map', 'json']);

    const isReferenceHost = (host: string) =>
      host === 'doi.org' ||
      host === 'dx.doi.org' ||
      host.endsWith('.ncbi.nlm.nih.gov') ||
      host.endsWith('.europepmc.org');

    const isCdn = (host: string) => host.startsWith('cdn.') || host.startsWith('static.');

    const scored: ScannedReference[] = [];
    const seen = new Set<string>();

    for (const raw of links) {
      if (visited?.has(raw)) continue;
      let u: URL;
      try { u = new URL(raw); } catch { continue; }
      if (isCdn(u.hostname)) continue;
      const sameHost = u.hostname === base.hostname;
      const refHost = isReferenceHost(u.hostname);
      if (!sameHost && !refHost) continue;
      if (u.pathname === base.pathname && u.search === base.search) continue;

      const path = u.pathname.toLowerCase();
      const search = u.search.toLowerCase();
      const pathParts = path.split('/').filter(Boolean);

      const ext = path.split('.').pop()?.toLowerCase();
      if (ext && badExtensions.has(ext)) continue;

      if (sameHost && pathParts.some((p) => excludedPathParts.has(p))) continue;
      if (u.pathname === base.pathname && !search) continue;

      const key = `${u.pathname}${u.search}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let score = 1;
      let category: ScannedReference['category'] = 'external';

      if (sameHost && (pathParts.some((p) => referenceKeywords.has(p)) || /\/(ref|references|reference)\/?$/.test(path))) {
        score += 10;
        category = 'reference';
      }
      if (!sameHost && refHost) { score += 6; category = refHost && (u.hostname === 'doi.org' || u.hostname === 'dx.doi.org') ? 'doi' : 'reference'; }
      if (sameHost && path.startsWith(base.pathname.replace(/\/[^/]*$/, ''))) { score += 2; if (category === 'external') category = 'sequential'; }
      for (const k of paginationKeywords) {
        if (search.includes(`${k}=`) || search.includes(`&${k}=`)) { score += 5; if (category === 'external') category = 'pagination'; break; }
      }
      if (/\/page\//.test(path) || /\/p\/\d+/.test(path) || /page[_-]?\d+/i.test(path)) { score += 6; if (category === 'external') category = 'pagination'; }
      if (pathParts.some((p) => referenceKeywords.has(p))) { score += 6; if (category === 'external') category = 'reference'; }
      if (pathParts.some((p) => sequentialKeywords.has(p))) { score += 4; if (category === 'external') category = 'sequential'; }
      if (/\?(p|page|start|offset|section|chapter|part)=/.test(search)) score += 3;
      if (u.hostname === 'doi.org' || u.hostname === 'dx.doi.org' || /\/pmc\/articles\//.test(path)) { score += 5; category = 'doi'; }

      const joined = `${path} ${search} ${u.hash}`.toLowerCase();
      for (const k of excludedKeywords) {
        if (joined.includes(k)) { score -= 4; }
      }
      if (pathParts.length <= 3) score += 1;

      if (score > 0) {
        // Derive a title from the URL path
        const lastPart = pathParts[pathParts.length - 1] ?? u.hostname;
        const title = decodeURIComponent(lastPart).replace(/[-_]/g, ' ').replace(/\.(html?|php|aspx?)$/, '').slice(0, 80);
        scored.push({ url: raw, score, title, host: u.hostname, sameHost, isReferenceHost: refHost, category });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  /**
   * Phase 1 of the scan-then-scrape workflow.
   * Fetches the root URL and returns a scan report of all discovered reference
   * links. Does NOT ingest anything into the knowledge base.
   */
  async scanUrl(
    url: string,
    _sessionId?: string,
    scanOpts?: { maxLinks?: number },
  ): Promise<UrlScanResult> {
    const maxLinks = Math.max(1, Math.min(scanOpts?.maxLinks ?? 250, 250));

    const result = await hybridFetchAndExtract(url);
    const content = result.markdown || result.text;
    if (!content.trim()) {
      throw new Error(`No content extracted from ${url} — the site may be blocking automated access.`);
    }

    const references = this.scoreReferenceLinks(result.links, url).slice(0, maxLinks);
    const title = result.title || (() => { try { return new URL(url).hostname; } catch { return url; } })();

    return {
      url,
      references,
      contentLength: content.length,
      title,
      fetchMethod: result.agentFetchMethod ?? 'unknown',
    };
  }

  /**
   * Phase 2 of the scan-then-scrape workflow.
   * Scrapes the selected reference URLs under a common root URL. If a rootUrl is
   * provided, it is first scraped as the parent source; every selected URL is then
   * ingested as a child of that root. If maxDepth > 1, each selected page's own
   * references are also followed recursively.
   */
  async scrapeReferences(
    urls: string[],
    sessionId?: string,
    opts?: { maxDepth?: number; maxLinks?: number; rootUrl?: string },
  ): Promise<string> {
    const maxDepth = Math.max(1, Math.min(opts?.maxDepth ?? 1, 10));
    const maxLinks = Math.max(0, Math.min(opts?.maxLinks ?? 25, 250));
    const rootUrl = opts?.rootUrl;
    const batchId = randomUUID();
    const batchState = { cancelled: false, paused: false };
    this.batchScrapes.set(batchId, batchState);

    const targets: string[] = rootUrl ? [rootUrl, ...urls] : urls;
    const total = targets.length;
    let completed = 0;
    let succeeded = 0;
    let failed = 0;
    const sourceIds: string[] = [];
    let rootId: string | undefined;

    this.emitBatchProgress({
      batchId, total, completed, currentIndex: 0, currentUrl: '',
      succeeded, failed, status: 'running', sourceIds: [],
    });

    for (let i = 0; i < targets.length; i++) {
      if (batchState.cancelled) break;
      while (batchState.paused && !batchState.cancelled) {
        await new Promise((r) => setTimeout(r, 500));
      }
      if (batchState.cancelled) break;

      const url = targets[i]!;
      this.emitBatchProgress({
        batchId, total, completed, currentIndex: i + 1, currentUrl: url,
        succeeded, failed, status: 'running', sourceIds: [...sourceIds],
      });

      try {
        const isRoot = i === 0 && rootUrl != null;
        if (isRoot) {
          const root = await this.scrapeSource(url, sessionId, { followLinks: false });
          rootId = root.id;
          sourceIds.push(root.id);
          succeeded++;
        } else {
          const source = await this.scrapeSource(url, sessionId, {
            parentId: rootId,
            followLinks: maxDepth > 1,
            maxDepth: maxDepth - 1,
            maxLinks,
          });
          sourceIds.push(source.id);
          succeeded++;
        }
      } catch (err) {
        failed++;
        this.logger.warn('KB_BATCH_SCRAPE', `Failed to scrape ${url}`, {
          batchId, error: err instanceof Error ? err.message : String(err),
        });
      }
      completed++;
    }

    this.emitBatchProgress({
      batchId, total, completed, currentIndex: total, currentUrl: '',
      succeeded, failed, status: batchState.cancelled ? 'paused' : 'done',
      sourceIds,
    });

    if (!batchState.cancelled) {
      this.batchScrapes.delete(batchId);
    }
    return batchId;
  }

  /** Pause a batch scrape. */
  pauseBatch(batchId: string): void {
    const batch = this.batchScrapes.get(batchId);
    if (batch) batch.paused = true;
  }

  /** Resume a batch scrape. */
  resumeBatch(batchId: string): void {
    const batch = this.batchScrapes.get(batchId);
    if (batch) batch.paused = false;
  }

  /** Cancel a batch scrape. */
  cancelBatch(batchId: string): void {
    const batch = this.batchScrapes.get(batchId);
    if (batch) batch.cancelled = true;
  }

  /**
   * Rescrape an existing URL source. Uses smart hash comparison:
   * - If content unchanged → skip (no re-embed), return with scrapeStatus='unchanged'
   * - If content changed → re-ingest with new content, scrapeStatus='updated'
   * - If URL is down (404/5xx/network error) → preserve existing chunks, scrapeStatus='unavailable'
   */
  async rescrapeSource(id: string): Promise<{ source: KnowledgeSource; action: 'skipped' | 'updated' | 'unavailable' }> {
    const source = await this.sourceStore.getSource(id);
    if (!source) throw new Error(`Knowledge base source not found: ${id}`);
    if (!source.sourceUrl) throw new Error('Source has no URL to rescrape');

    this.emitStatus(id, 'extracting', 5, `Rescraping ${source.sourceUrl}`);

    let result;
    try {
      result = await hybridFetchAndExtract(source.sourceUrl);
    } catch (err) {
      // URL is down — preserve existing chunks, mark unavailable
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn('KB_RESCRAPE', `URL unavailable: ${source.sourceUrl}`, { error: errorMsg });
      await this.sourceStore.updateSource(id, {
        scrapeStatus: 'unavailable',
        error: `URL unavailable: ${errorMsg}`,
      });
      this.emitStatus(id, 'failed', 0, `URL unavailable — existing chunks preserved`, errorMsg);
      const updated = await this.sourceStore.getSource(id);
      return { source: updated!, action: 'unavailable' };
    }

    const content = result.markdown || result.text;
    if (!content.trim()) {
      await this.sourceStore.updateSource(id, {
        scrapeStatus: 'unavailable',
        error: 'No content extracted — page may be empty or taken down',
      });
      this.emitStatus(id, 'failed', 0, 'No content extracted — existing chunks preserved', 'Empty response');
      const updated = await this.sourceStore.getSource(id);
      return { source: updated!, action: 'unavailable' };
    }

    const newHash = createHash('sha256').update(content).digest('hex');

    // Smart hash compare — skip if unchanged
    if (source.contentHash && source.contentHash === newHash) {
      await this.sourceStore.updateSource(id, {
        scrapeStatus: 'unchanged',
        lastScrapedAt: new Date().toISOString(),
        error: null,
      });
      this.emitStatus(id, 'ready', 100, 'Content unchanged — no re-embedding needed');
      const updated = await this.sourceStore.getSource(id);
      return { source: updated!, action: 'skipped' };
    }

    // Content changed — re-ingest
    this.emitStatus(id, 'extracting', 15, 'Content changed — re-ingesting');

    // Emit literal content snippets for the spy HUD terminal
    const snippetLines = content.split('\n').filter((l) => l.trim()).slice(0, 20);
    for (let i = 0; i < snippetLines.length; i++) {
      const snippet = snippetLines[i]!.trim().slice(0, 80);
      this.emitStatus(id, 'extracting', 15 + Math.floor((i / snippetLines.length) * 10), `> ${snippet}`);
    }

    const title = result.title || source.name;
    const filename = `${title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)}.md`;

    const attachment = await getAttachmentService().saveFromBuffer(
      source.sessionId ?? 'global',
      filename,
      Buffer.from(content, 'utf-8'),
      'text/markdown',
      'scrape',
    );

    // Update source with new content + hash, then re-ingest
    await this.pool.query(
      `UPDATE memory_sources SET storage_id = $1, file_size = $2, content_hash = $3, scrape_status = 'updated', last_scraped_at = NOW(), origin = $4, status = 'pending', progress = 0, error = NULL, updated_at = NOW() WHERE id = $5::uuid`,
      [attachment.id, Buffer.byteLength(content, 'utf-8'), newHash, KnowledgeBaseOrigin.websiteRescrape, id],
    );

    this.emitStatus(id, 'pending', 0, 'Re-scrape complete — queued for re-ingestion');
    this.enqueueProcess(id);

    const updated = await this.sourceStore.getSource(id);
    return { source: updated!, action: 'updated' };
  }
}
