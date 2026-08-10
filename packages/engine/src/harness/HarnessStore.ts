import type {
  HarnessEntry,
  HarnessKind,
  HarnessRefinementEvent,
  HarnessScope,
  HarnessState,
  RefinementAction,
} from '@agentx/shared';
import { getAdoptionDbPool } from '../adoption/adoption-db.js';
import { HarnessFileStore } from './HarnessFileStore.js';
import { HarnessPostgresStore } from './HarnessPostgresStore.js';

export interface HarnessStoreBackend {
  readState(scope: HarnessScope, sessionId?: string): HarnessState | Promise<HarnessState>;
  listEntries(scope: HarnessScope, sessionId?: string, kind?: HarnessKind): HarnessEntry[] | Promise<HarnessEntry[]>;
  upsertEntry(scope: HarnessScope, sessionId: string | undefined, entry: HarnessEntry): HarnessEntry | Promise<HarnessEntry>;
  deleteEntry(scope: HarnessScope, sessionId: string | undefined, kind: HarnessKind, id: string): boolean | Promise<boolean>;
  appendRefinement(scope: HarnessScope, sessionId: string | undefined, event: HarnessRefinementEvent): void | Promise<void>;
  listRefinements(scope: HarnessScope, sessionId?: string): HarnessRefinementEvent[] | Promise<HarnessRefinementEvent[]>;
  cloneState(scope: HarnessScope, sessionId?: string): HarnessState | Promise<HarnessState>;
  applyEdit(
    scope: HarnessScope,
    sessionId: string | undefined,
    action: RefinementAction,
    kind: HarnessKind,
    patch: Partial<HarnessEntry> & { id?: string },
  ): HarnessEntry | null | Promise<HarnessEntry | null>;
}

export class HarnessStore implements HarnessStoreBackend {
  private readonly fileStore = new HarnessFileStore();
  private postgres: HarnessPostgresStore | null = null;

  private ensurePostgres(): HarnessPostgresStore | null {
    const pool = getAdoptionDbPool();
    if (!pool) return null;
    if (!this.postgres) this.postgres = new HarnessPostgresStore(pool);
    return this.postgres;
  }

  readState(scope: HarnessScope, sessionId?: string) {
    const file = this.fileStore.readState(scope, sessionId);
    const pg = this.ensurePostgres();
    if (pg) {
      return pg.readState(scope, sessionId).catch(() => file);
    }
    return file;
  }

  listEntries(scope: HarnessScope, sessionId?: string, kind?: HarnessKind) {
    const file = this.fileStore.listEntries(scope, sessionId, kind);
    const pg = this.ensurePostgres();
    if (pg) {
      return pg.listEntries(scope, sessionId, kind).catch(() => file);
    }
    return file;
  }

  upsertEntry(scope: HarnessScope, sessionId: string | undefined, entry: HarnessEntry) {
    const file = this.fileStore.upsertEntry(scope, sessionId, entry);
    const pg = this.ensurePostgres();
    if (pg) {
      return pg.upsertEntry(scope, sessionId, entry).then(() => file);
    }
    return file;
  }

  deleteEntry(scope: HarnessScope, sessionId: string | undefined, kind: HarnessKind, id: string) {
    const file = this.fileStore.deleteEntry(scope, sessionId, kind, id);
    const pg = this.ensurePostgres();
    if (pg) {
      return pg.deleteEntry(scope, sessionId, kind, id).then(() => file);
    }
    return file;
  }

  appendRefinement(scope: HarnessScope, sessionId: string | undefined, event: HarnessRefinementEvent) {
    this.fileStore.appendRefinement(scope, sessionId, event);
    const pg = this.ensurePostgres();
    if (pg) {
      return pg.appendRefinement(scope, sessionId, event);
    }
  }

  listRefinements(scope: HarnessScope, sessionId?: string) {
    const file = this.fileStore.listRefinements(scope, sessionId);
    const pg = this.ensurePostgres();
    if (pg) {
      return pg.listRefinements(scope, sessionId).catch(() => file);
    }
    return file;
  }

  cloneState(scope: HarnessScope, sessionId?: string) {
    const file = this.fileStore.cloneState(scope, sessionId);
    const pg = this.ensurePostgres();
    if (pg) {
      return pg.cloneState(scope, sessionId).catch(() => file);
    }
    return file;
  }

  applyEdit(
    scope: HarnessScope,
    sessionId: string | undefined,
    action: RefinementAction,
    kind: HarnessKind,
    patch: Partial<HarnessEntry> & { id?: string },
  ) {
    const fileResult = this.fileStore.applyEdit(scope, sessionId, action, kind, patch);
    const pg = this.ensurePostgres();
    if (pg) {
      return pg.applyEdit(scope, sessionId, action, kind, patch).then(() => fileResult);
    }
    return fileResult;
  }

  /** File store for sync writes used by applyRefinement (sync path). */
  getFileStore(): HarnessFileStore {
    return this.fileStore;
  }
}
