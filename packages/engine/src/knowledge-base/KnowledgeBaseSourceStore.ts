import type { Pool, QueryResultRow } from 'pg';
import type {
  CreateKnowledgeSourceInput,
  KnowledgeSource,
  KnowledgeSourceStatus,
  ScrapeStatus,
} from '@agentx/shared';
import { KnowledgeBaseOrigin } from '@agentx/shared';

const KB_ORIGIN_PREFIX = 'kb.';

function toISOString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export class KnowledgeBaseSourceStore {
  constructor(private pool: Pool) {}

  private rowToSource(row: QueryResultRow): KnowledgeSource {
    return {
      id: row.id as string,
      sessionId: row.session_id ? String(row.session_id) : undefined,
      name: row.name as string,
      mimeType: (row.file_mime as string) ?? 'application/octet-stream',
      size: row.file_size != null ? Number(row.file_size) : 0,
      storageId: (row.storage_id as string) ?? '',
      status: row.status as KnowledgeSourceStatus,
      progress: Number(row.progress ?? 0),
      error: row.error ? String(row.error) : undefined,
      summary: row.summary ? String(row.summary) : undefined,
      chunkCount: row.chunk_count != null ? Number(row.chunk_count) : undefined,
      pageCount: row.page_count != null ? Number(row.page_count) : undefined,
      sourceUrl: row.source_url ? String(row.source_url) : undefined,
      contentHash: row.content_hash ? String(row.content_hash) : undefined,
      lastScrapedAt: row.last_scraped_at ? toISOString(row.last_scraped_at) : undefined,
      scrapeStatus: row.scrape_status ? (row.scrape_status as ScrapeStatus) : undefined,
      createdAt: toISOString(row.created_at),
      updatedAt: toISOString(row.updated_at ?? row.created_at),
    };
  }

  async insertSource(input: CreateKnowledgeSourceInput): Promise<KnowledgeSource> {
    const origin = input.origin ?? KnowledgeBaseOrigin.documentUpload;
    const { rows } = await this.pool.query(
      `INSERT INTO memory_sources
        (name, kind, color_hex, origin, session_id, storage_id, file_size, file_mime, status, progress,
         source_url, content_hash, scrape_status)
       VALUES ($1, 'document', '#4a90d9', $2, $3, $4, $5, $6, 'pending', 0, $7, $8, $9)
       RETURNING *`,
      [
        input.name,
        origin,
        input.sessionId ?? null,
        input.storageId,
        input.size,
        input.mimeType,
        input.sourceUrl ?? null,
        input.contentHash ?? null,
        input.sourceUrl ? 'fresh' : null,
      ],
    );
    if (!rows[0]) throw new Error('Failed to create knowledge base source');
    return this.rowToSource(rows[0]);
  }

  async updateSource(
    id: string,
    patch: Partial<Pick<KnowledgeSource, 'status' | 'progress' | 'summary' | 'chunkCount' | 'pageCount' | 'contentHash' | 'scrapeStatus' | 'lastScrapedAt'>> & {
      error?: string | null;
      embeddingTier?: string | null;
    },
  ): Promise<KnowledgeSource | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let n = 1;
    if (patch.status !== undefined) {
      sets.push(`status = $${n++}`);
      values.push(patch.status);
    }
    if (patch.progress !== undefined) {
      sets.push(`progress = $${n++}`);
      values.push(patch.progress);
    }
    if ('error' in patch) {
      sets.push(`error = $${n++}`);
      values.push(patch.error ?? null);
    }
    if (patch.summary !== undefined) {
      sets.push(`summary = $${n++}`);
      values.push(patch.summary ?? null);
    }
    if (patch.chunkCount !== undefined) {
      sets.push(`chunk_count = $${n++}`);
      values.push(patch.chunkCount ?? null);
    }
    if (patch.pageCount !== undefined) {
      sets.push(`page_count = $${n++}`);
      values.push(patch.pageCount ?? null);
    }
    if ('embeddingTier' in patch) {
      sets.push(`embedding_tier = $${n++}`);
      values.push(patch.embeddingTier ?? null);
    }
    if (patch.contentHash !== undefined) {
      sets.push(`content_hash = $${n++}`);
      values.push(patch.contentHash ?? null);
    }
    if (patch.scrapeStatus !== undefined) {
      sets.push(`scrape_status = $${n++}`);
      values.push(patch.scrapeStatus);
    }
    if (patch.lastScrapedAt !== undefined) {
      sets.push(`last_scraped_at = $${n++}`);
      values.push(patch.lastScrapedAt ?? null);
    }
    if (sets.length === 0) return this.getSource(id);

    sets.push('updated_at = NOW()');
    values.push(id);
    const q = `UPDATE memory_sources SET ${sets.join(', ')} WHERE id = $${n}::uuid RETURNING *`;
    const { rows } = await this.pool.query(q, values);
    if (!rows[0]) return null;
    return this.rowToSource(rows[0]);
  }

  async getSource(id: string): Promise<KnowledgeSource | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM memory_sources WHERE id = $1::uuid AND origin LIKE $2`,
      [id, `${KB_ORIGIN_PREFIX}%`],
    );
    if (!rows[0]) return null;
    return this.rowToSource(rows[0]);
  }

  async getSourceByUrl(url: string, sessionId?: string): Promise<KnowledgeSource | null> {
    if (sessionId) {
      const { rows } = await this.pool.query(
        `SELECT * FROM memory_sources WHERE source_url = $1 AND session_id = $2 AND origin LIKE $3 ORDER BY updated_at DESC LIMIT 1`,
        [url, sessionId, `${KB_ORIGIN_PREFIX}%`],
      );
      return rows[0] ? this.rowToSource(rows[0]) : null;
    }
    const { rows } = await this.pool.query(
      `SELECT * FROM memory_sources WHERE source_url = $1 AND origin LIKE $2 ORDER BY updated_at DESC LIMIT 1`,
      [url, `${KB_ORIGIN_PREFIX}%`],
    );
    return rows[0] ? this.rowToSource(rows[0]) : null;
  }

  async listSources(sessionId?: string): Promise<KnowledgeSource[]> {
    if (sessionId) {
      const { rows } = await this.pool.query(
        `SELECT * FROM memory_sources WHERE origin LIKE $1 AND session_id = $2 ORDER BY created_at DESC`,
        [`${KB_ORIGIN_PREFIX}%`, sessionId],
      );
      return rows.map((r) => this.rowToSource(r));
    }
    const { rows } = await this.pool.query(
      `SELECT * FROM memory_sources WHERE origin LIKE $1 ORDER BY created_at DESC`,
      [`${KB_ORIGIN_PREFIX}%`],
    );
    return rows.map((r) => this.rowToSource(r));
  }

  async deleteSource(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM memory_sources WHERE id = $1::uuid`, [id]);
  }

  async addIngestEvent(
    sourceId: string,
    stage: string,
    progress: number,
    detail?: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO knowledge_base_ingest_events (source_id, stage, detail, progress)
       VALUES ($1::uuid, $2, $3, $4)`,
      [sourceId, stage, detail ?? null, progress],
    );
  }

  async listIngestEvents(
    sourceId: string,
    limit = 200,
  ): Promise<Array<{ id: number; stage: string; detail: string | null; progress: number; createdAt: string }>> {
    const { rows } = await this.pool.query(
      `SELECT id, stage, detail, progress, created_at
       FROM knowledge_base_ingest_events
       WHERE source_id = $1::uuid
       ORDER BY id ASC
       LIMIT $2`,
      [sourceId, limit],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      stage: String(r.stage),
      detail: r.detail != null ? String(r.detail) : null,
      progress: Number(r.progress),
      createdAt: toISOString(r.created_at),
    }));
  }
}
