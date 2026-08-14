import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { toNeutralJid } from '../identity/wa-id.js';
import type {
  StandingOrder,
  StandingOrderAction,
  StandingOrderMatch,
  StandingOrderSource,
  StandingOrderWrite,
} from './standing-order-types.js';

type PgPool = Pick<Pool, 'query'>;

function normalizeMatch(match: StandingOrderMatch): StandingOrderMatch {
  return {
    senders: match.senders?.map((j) => toNeutralJid(j)).filter(Boolean),
    groups: match.groups?.map((j) => toNeutralJid(j)).filter(Boolean),
    keywords: match.keywords?.map((k) => k.trim()).filter(Boolean),
    chatKind: match.chatKind ?? 'any',
  };
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object') return value as T;
  if (typeof value === 'string' && value.trim()) {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return fallback;
}

function rowToOrder(row: Record<string, unknown>): StandingOrder {
  return {
    id: String(row['id']),
    title: String(row['title']),
    enabled: Boolean(row['enabled']),
    priority: Number(row['priority'] ?? 0),
    match: parseJson<StandingOrderMatch>(row['match_json'], {}),
    action: parseJson<StandingOrderAction>(row['action_json'], { type: 'brief' }),
    createdFrom: (row['created_from'] as StandingOrderSource) ?? 'unknown',
    createdAt: new Date(String(row['created_at'])).toISOString(),
    updatedAt: new Date(String(row['updated_at'])).toISOString(),
  };
}

export class StandingOrderStore {
  constructor(private readonly pool: PgPool) {}

  async list(enabledOnly = false): Promise<StandingOrder[]> {
    const sql = enabledOnly
      ? `SELECT * FROM whatsapp_standing_orders WHERE enabled = TRUE ORDER BY priority DESC, created_at ASC`
      : `SELECT * FROM whatsapp_standing_orders ORDER BY priority DESC, created_at ASC`;
    const { rows } = await this.pool.query(sql);
    return rows.map((r) => rowToOrder(r as Record<string, unknown>));
  }

  async getById(id: string): Promise<StandingOrder | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM whatsapp_standing_orders WHERE id = $1`,
      [id],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? rowToOrder(row) : null;
  }

  async findByTitle(title: string): Promise<StandingOrder | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM whatsapp_standing_orders WHERE lower(title) = lower($1) LIMIT 1`,
      [title.trim()],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? rowToOrder(row) : null;
  }

  async upsert(input: StandingOrderWrite): Promise<StandingOrder> {
    const existing = input.id
      ? await this.getById(input.id)
      : await this.findByTitle(input.title);
    const id = existing?.id ?? input.id ?? randomUUID();
    const match = normalizeMatch(input.match);
    const action = input.action;
    const enabled = input.enabled ?? existing?.enabled ?? true;
    const priority = input.priority ?? existing?.priority ?? 0;
    const createdFrom = input.createdFrom ?? existing?.createdFrom ?? 'unknown';

    const { rows } = await this.pool.query(
      `INSERT INTO whatsapp_standing_orders
         (id, title, enabled, priority, match_json, action_json, created_from, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,NOW(),NOW())
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         enabled = EXCLUDED.enabled,
         priority = EXCLUDED.priority,
         match_json = EXCLUDED.match_json,
         action_json = EXCLUDED.action_json,
         updated_at = NOW()
       RETURNING *`,
      [
        id,
        input.title.trim(),
        enabled,
        priority,
        JSON.stringify(match),
        JSON.stringify(action),
        createdFrom,
      ],
    );
    return rowToOrder(rows[0] as Record<string, unknown>);
  }

  async revoke(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM whatsapp_standing_orders WHERE id = $1`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async revokeByTitle(title: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM whatsapp_standing_orders WHERE lower(title) = lower($1)`,
      [title.trim()],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async revokeAll(): Promise<number> {
    const result = await this.pool.query(`DELETE FROM whatsapp_standing_orders`);
    return result.rowCount ?? 0;
  }
}
