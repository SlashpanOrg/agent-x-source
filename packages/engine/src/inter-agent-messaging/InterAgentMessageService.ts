import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { AdoptionAgentMessage, AgentMessageDeliveryMode, AgentMessageReceiverRole } from '@agentx/shared';
import { isInterAgentMessagingEnabled } from '@agentx/shared';
import { getAdoptionDbPool } from '../adoption/adoption-db.js';

export class InterAgentMessageService {
  isEnabled(): boolean {
    return isInterAgentMessagingEnabled();
  }

  private pool(): Pool | null {
    return getAdoptionDbPool();
  }

  async enqueue(
    fromSessionId: string,
    toSessionId: string,
    topic: string,
    payload: Record<string, unknown>,
    deliveryMode: AgentMessageDeliveryMode = 'auto',
    receiverRole: AgentMessageReceiverRole = 'sibling',
  ): Promise<AdoptionAgentMessage> {
    if (receiverRole === 'sibling' && !await this.canMessageSibling(fromSessionId, toSessionId)) {
      throw new Error('sibling_messaging_not_allowed');
    }
    const message: AdoptionAgentMessage = {
      id: randomUUID(),
      fromSessionId,
      toSessionId,
      topic,
      payload,
      deliveryMode,
      receiverRole,
      timestamp: Date.now(),
    };
    const pool = this.pool();
    if (pool && this.isEnabled()) {
      await pool.query(
        `INSERT INTO agent_messages (id, from_session_id, to_session_id, topic, payload, delivery_mode, receiver_role, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
        [
          message.id,
          fromSessionId,
          toSessionId,
          topic,
          JSON.stringify(payload),
          deliveryMode,
          receiverRole,
        ],
      );
    }
    return message;
  }

  async listPending(toSessionId: string, limit = 20): Promise<AdoptionAgentMessage[]> {
    const pool = this.pool();
    if (!pool || !this.isEnabled()) return [];
    const res = await pool.query(
      `SELECT * FROM agent_messages WHERE to_session_id = $1 AND delivered_at IS NULL ORDER BY created_at ASC LIMIT $2`,
      [toSessionId, limit],
    );
    return res.rows.map((row) => this.rowToMessage(row as Record<string, unknown>));
  }

  async markDelivered(id: string): Promise<void> {
    const pool = this.pool();
    if (!pool || !this.isEnabled()) return;
    await pool.query(`UPDATE agent_messages SET delivered_at = NOW() WHERE id = $1`, [id]);
  }

  /** Crew private sessions and orchestrator crew siblings may message each other. */
  async canMessageSibling(fromSessionId: string, toSessionId: string): Promise<boolean> {
    if (fromSessionId === toSessionId) return true;
    const fromCrew = fromSessionId.includes('::crew:');
    const toCrew = toSessionId.includes('::crew:');
    if (fromCrew && toCrew) {
      const fromHost = fromSessionId.split('::crew:')[0];
      const toHost = toSessionId.split('::crew:')[0];
      return Boolean(fromHost && fromHost === toHost);
    }
    const pool = this.pool();
    if (!pool) return true;
    const res = await pool.query(
      `SELECT id, context_kind, host_crew_id FROM sessions WHERE id = ANY($1::text[])`,
      [[fromSessionId, toSessionId]],
    );
    const rows = res.rows as Array<{ id: string; context_kind: string; host_crew_id: string | null }>;
    const from = rows.find((r) => r.id === fromSessionId);
    const to = rows.find((r) => r.id === toSessionId);
    if (!from || !to) return false;
    if (from.context_kind === 'crew_private' && to.context_kind === 'crew_private') {
      return Boolean(from.host_crew_id && from.host_crew_id === to.host_crew_id);
    }
    return true;
  }

  private rowToMessage(row: Record<string, unknown>): AdoptionAgentMessage {
    return {
      id: String(row.id),
      fromSessionId: String(row.from_session_id),
      toSessionId: String(row.to_session_id),
      topic: String(row.topic ?? ''),
      payload: (row.payload as Record<string, unknown>) ?? {},
      deliveryMode: (row.delivery_mode as AdoptionAgentMessage['deliveryMode']) ?? 'auto',
      receiverRole: (row.receiver_role as AdoptionAgentMessage['receiverRole']) ?? 'sibling',
      timestamp: new Date(String(row.created_at)).getTime(),
      deliveredAt: row.delivered_at ? String(row.delivered_at) : undefined,
    };
  }
}

let service: InterAgentMessageService | null = null;

export function getInterAgentMessageService(): InterAgentMessageService {
  if (!service) service = new InterAgentMessageService();
  return service;
}
