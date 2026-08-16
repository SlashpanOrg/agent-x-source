import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildListDayDivider,
  generateId,
  getArticlesDir,
  deriveArticleExcerpt,
  deriveArticleKind,
  deriveArticleTitle,
  isArticleKind,
  normalizeArticleInput,
  recoverArticleTableHeader,
} from '@agentx/shared';
import type {
  ArticleRecord,
  CreateArticleInput,
  ArticlePayload,
} from '@agentx/shared';

export type ArticleDbPool = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

const BODY_FILE = 'content.md';

function ensureArticlesDir(): string {
  const dir = getArticlesDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

function rowToRecord(row: Record<string, unknown>): ArticleRecord {
  return {
    id: row['id'] as string,
    sessionId: (row['session_id'] as string | null) ?? null,
    messageId: (row['message_id'] as string) ?? null,
    title: row['title'] as string,
    excerpt: (row['excerpt'] as string) ?? '',
    filePath: row['file_path'] as string,
    contentFormat: isArticleKind(row['content_format']) ? row['content_format'] : 'article',
    sourceRole: (row['source_role'] as ArticleRecord['sourceRole']) ?? null,
    createdAt: new Date(row['created_at'] as string).toISOString(),
    updatedAt: new Date(row['updated_at'] as string).toISOString(),
    listDayKey: (row['list_day_key'] as string | null | undefined) ?? null,
    listDayLabel: (row['list_day_label'] as string | null | undefined) ?? null,
  };
}

function articleDir(id: string): string {
  return join(ensureArticlesDir(), id);
}

function readArticleBody(record: ArticleRecord): string | null {
  const bodyPath = join(articleDir(record.id), BODY_FILE);
  if (!existsSync(bodyPath)) return null;
  return recoverArticleTableHeader(readFileSync(bodyPath, 'utf8'), record.title);
}

export class ArticleStore {
  constructor(private pool: ArticleDbPool) {
    ensureArticlesDir();
  }

  async create(input: CreateArticleInput): Promise<ArticleRecord> {
    const id = generateId('art');
    const absDir = join(ensureArticlesDir(), id);
    mkdirSync(absDir, { recursive: true });

    const title = deriveArticleTitle({
      title: input.title,
      content: input.content,
    });

    const body = normalizeArticleInput({
      title,
      content: input.content,
    });
    if (!body) {
      throw new Error('content is required');
    }

    const relFile = join('articles', id, BODY_FILE);
    writeFileSync(join(absDir, BODY_FILE), body, 'utf8');

    const excerpt = deriveArticleExcerpt(body);
    const kind = deriveArticleKind({ kind: input.kind, title, content: body });
    const now = new Date().toISOString();
    const { dayKey: listDayKey, dayLabel: listDayLabel } = buildListDayDivider(now);

    await this.pool.query(
      `INSERT INTO articles (id, session_id, message_id, title, excerpt, file_path, content_format, source_role, compile_error, created_at, updated_at, list_day_key, list_day_label)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, $9, $10, $11)`,
      [
        id,
        input.sessionId,
        input.messageId ?? null,
        title,
        excerpt,
        relFile.replace(/\\/g, '/'),
        kind,
        input.sourceRole ?? null,
        now,
        listDayKey,
        listDayLabel,
      ],
    );

    return {
      id,
      sessionId: input.sessionId,
      messageId: input.messageId ?? null,
      title,
      excerpt,
      filePath: relFile.replace(/\\/g, '/'),
      contentFormat: kind,
      sourceRole: input.sourceRole ?? null,
      createdAt: now,
      updatedAt: now,
      listDayKey,
      listDayLabel,
    };
  }

  async list(limit = 50, offset = 0): Promise<ArticleRecord[]> {
    const lim = Math.max(1, Math.min(200, limit));
    const off = Math.max(0, offset);
    const { rows } = await this.pool.query(
      `SELECT * FROM articles ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [lim, off],
    );
    return rows.map(rowToRecord);
  }

  async listForSession(sessionId: string, limit = 50): Promise<ArticleRecord[]> {
    const lim = Math.max(1, Math.min(200, limit));
    const { rows } = await this.pool.query(
      `SELECT * FROM articles WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [sessionId, lim],
    );
    return rows.map(rowToRecord);
  }

  async get(id: string): Promise<ArticleRecord | null> {
    const { rows } = await this.pool.query(`SELECT * FROM articles WHERE id = $1`, [id]);
    if (rows.length === 0) return null;
    return rowToRecord(rows[0]!);
  }

  async getContent(id: string): Promise<ArticlePayload | null> {
    const record = await this.get(id);
    if (!record) return null;
    const content = readArticleBody(record);
    if (!content) return null;
    return { record, content };
  }

  async delete(id: string): Promise<boolean> {
    const record = await this.get(id);
    if (!record) return false;
    const absDir = articleDir(record.id);
    if (existsSync(absDir)) {
      try { rmSync(absDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    await this.pool.query(`DELETE FROM articles WHERE id = $1`, [id]);
    return true;
  }
}

let _store: ArticleStore | null = null;

export function setArticleStoreInstance(store: ArticleStore | null): void {
  _store = store;
}

export function getArticleStoreInstance(): ArticleStore | null {
  return _store;
}
