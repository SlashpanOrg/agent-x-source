/**
 * In-memory pg.Pool stub for adoption Phase 2 integration tests.
 */
export class AdoptionFakePgPool {
  private leases = new Map<string, { owner_id: string; expires_at: string; holder_pid: number; holder_instance: string }>();
  private durableTurns = new Map<string, Record<string, unknown>>();
  private commandJournal = new Map<string, Record<string, unknown>>();
  private advisoryLocks = new Set<number>();

  async query(sql: string, params: unknown[] = []): Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number }> {
    const s = sql.trim();

    if (s.startsWith('SELECT pg_try_advisory_lock')) {
      const key = Number(params[0]);
      if (this.advisoryLocks.has(key)) return { rows: [{ ok: false }] };
      this.advisoryLocks.add(key);
      return { rows: [{ ok: true }] };
    }
    if (s.startsWith('SELECT pg_advisory_unlock')) {
      const key = Number(params[0]);
      this.advisoryLocks.delete(key);
      return { rows: [] };
    }

    if (s.includes('FROM session_leases WHERE session_id = $1 AND expires_at > NOW()')) {
      const sessionId = String(params[0]);
      const row = this.leases.get(sessionId);
      if (!row || new Date(row.expires_at) <= new Date()) return { rows: [] };
      return { rows: [row as Record<string, unknown>] };
    }

    if (s.startsWith('INSERT INTO session_leases')) {
      const [sessionId, ownerId, pid, instance, expires] = params as [string, string, number, string, string];
      const existing = this.leases.get(sessionId);
      if (existing && new Date(existing.expires_at) > new Date() && existing.owner_id !== ownerId) {
        return { rows: [], rowCount: 0 };
      }
      this.leases.set(sessionId, {
        owner_id: ownerId,
        holder_pid: pid,
        holder_instance: instance,
        expires_at: expires,
      });
      return { rows: [], rowCount: 1 };
    }

    if (s.startsWith('DELETE FROM session_leases WHERE session_id')) {
      const sessionId = String(params[0]);
      const ownerId = String(params[1]);
      const row = this.leases.get(sessionId);
      if (row?.owner_id === ownerId) this.leases.delete(sessionId);
      return { rows: [], rowCount: 1 };
    }

    if (s.startsWith('DELETE FROM session_leases WHERE owner_id')) {
      const ownerId = String(params[0]);
      for (const [sid, row] of this.leases.entries()) {
        if (row.owner_id === ownerId) this.leases.delete(sid);
      }
      return { rows: [], rowCount: 1 };
    }

    if (s.startsWith('UPDATE session_leases SET expires_at')) {
      const sessionId = String(params[0]);
      const ownerId = String(params[1]);
      const expires = String(params[2]);
      const row = this.leases.get(sessionId);
      if (row && row.owner_id === ownerId && new Date(row.expires_at) > new Date()) {
        row.expires_at = expires;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (s.startsWith('INSERT INTO durable_turns')) {
      const [turnId, sessionId, status, generation, sequence] = params as [string, string, string, number, number];
      this.durableTurns.set(turnId, {
        turn_id: turnId,
        session_id: sessionId,
        status,
        generation,
        sequence,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return { rows: [], rowCount: 1 };
    }

    if (s.includes('UPDATE durable_turns SET status = $2')) {
      const turnId = String(params[0]);
      const row = this.durableTurns.get(turnId);
      if (row) {
        row.status = params[1];
        row.updated_at = new Date().toISOString();
        if (params[2]) row.partial_content = params[2];
        if (params[3]) row.error = params[3];
        if (['complete', 'error', 'cancelled'].includes(String(params[1]))) {
          row.completed_at = new Date().toISOString();
        }
      }
      return { rows: [], rowCount: 1 };
    }

    if (s.includes('stale_after_restart')) {
      let count = 0;
      for (const row of this.durableTurns.values()) {
        if (['queued', 'running', 'checkpointed'].includes(String(row.status))) {
          row.status = 'error';
          row.error = 'stale_after_restart';
          row.updated_at = new Date().toISOString();
          row.completed_at = new Date().toISOString();
          count += 1;
        }
      }
      return { rows: [], rowCount: count };
    }

    if (s.startsWith('INSERT INTO turn_checkpoints')) {
      const turnId = String(params[1]);
      const row = this.durableTurns.get(turnId);
      if (row) {
        row.sequence = Number(params[2]);
        if (params[4]) row.partial_content = params[4];
        row.updated_at = new Date().toISOString();
      }
      return { rows: [], rowCount: 1 };
    }

    if (s.startsWith('UPDATE durable_turns SET sequence')) {
      const turnId = String(params[0]);
      const row = this.durableTurns.get(turnId);
      if (row) {
        row.sequence = Number(params[1]);
        if (params[2]) row.partial_content = params[2];
        row.updated_at = new Date().toISOString();
      }
      return { rows: [], rowCount: 1 };
    }

    if (s.startsWith('SELECT * FROM durable_turns WHERE turn_id')) {
      const turnId = String(params[0]);
      const row = this.durableTurns.get(turnId);
      return { rows: row ? [row] : [] };
    }

    if (s.includes('FROM durable_turns WHERE session_id = $1 AND status NOT IN')) {
      const sessionId = String(params[0]);
      const active = [...this.durableTurns.values()].filter(
        (r) => r.session_id === sessionId && !['complete', 'error', 'cancelled'].includes(String(r.status)),
      );
      return { rows: active.length ? [active[active.length - 1]!] : [] };
    }

    if (s.startsWith('INSERT INTO command_journal')) {
      const [id, key, commandType, sessionId, payload] = params as [string, string, string, string | null, string];
      if (this.commandJournal.has(key)) return { rows: [], rowCount: 0 };
      this.commandJournal.set(key, {
        id,
        idempotency_key: key,
        command_type: commandType,
        session_id: sessionId,
        payload,
        status: 'received',
        received_at: new Date().toISOString(),
      });
      return { rows: [], rowCount: 1 };
    }

    if (s.startsWith('SELECT * FROM command_journal WHERE idempotency_key')) {
      const key = String(params[0]);
      const row = this.commandJournal.get(key);
      return { rows: row ? [row] : [] };
    }

    if (s.startsWith('UPDATE command_journal SET status = \'completed\'')) {
      const key = String(params[0]);
      const row = this.commandJournal.get(key);
      if (row) {
        row.status = 'completed';
        try {
          row.result = JSON.parse(String(params[1]));
        } catch {
          row.result = params[1];
        }
      }
      return { rows: [], rowCount: 1 };
    }

    if (s.startsWith('UPDATE command_journal SET status = \'uncertain\'')) {
      let count = 0;
      for (const row of this.commandJournal.values()) {
        if (row.status === 'received') {
          row.status = 'uncertain';
          count += 1;
        }
      }
      return { rows: [], rowCount: count };
    }

    throw new Error(`AdoptionFakePgPool: unhandled query: ${s.slice(0, 80)}`);
  }
}
