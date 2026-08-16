import type { CrewVoiceSessionInfo, VoiceCallSummary } from '../../api';
import { groupByPersistedListDay } from '../../list-day-groups';

export type UnifiedCallRow =
  | {
      kind: 'crew';
      id: string;
      sortAt: string;
      crew: CrewVoiceSessionInfo;
    }
  | {
      kind: 'voip';
      id: string;
      sortAt: string;
      voip: VoiceCallSummary;
    };

export interface CallSessionDayGroup {
  dayKey: string;
  label: string;
  items: UnifiedCallRow[];
}

function rowTimestamp(row: UnifiedCallRow): number {
  const t = Date.parse(row.sortAt);
  return Number.isFinite(t) ? t : 0;
}

export function crewRowFromSession(session: CrewVoiceSessionInfo): UnifiedCallRow {
  return {
    kind: 'crew',
    id: `crew:${session.id}`,
    sortAt: session.updatedAt ?? session.createdAt ?? new Date(0).toISOString(),
    crew: session,
  };
}

export function voipRowFromCall(call: VoiceCallSummary): UnifiedCallRow {
  return {
    kind: 'voip',
    id: `voip:${call.id}`,
    sortAt: call.startedAt ?? call.endedAt ?? new Date(0).toISOString(),
    voip: call,
  };
}

/** Newest calls first. */
export function sortCallsLatestFirst(rows: UnifiedCallRow[]): UnifiedCallRow[] {
  return [...rows].sort((a, b) => rowTimestamp(b) - rowTimestamp(a));
}

/**
 * Group call history by persisted list-day fields when present on crew sessions;
 * VOIP falls back to startedAt calendar day.
 */
export function groupCallSessionsByDay(items: UnifiedCallRow[]): CallSessionDayGroup[] {
  const sorted = sortCallsLatestFirst(items);
  // Adapt to groupByPersistedListDay which expects { createdAt/listDay* } — map VOIP
  // into a synthetic shape with createdAt = sortAt.
  const adapted = sorted.map((row) => {
    if (row.kind === 'crew') {
      return { ...row.crew, __unified: row };
    }
    return {
      id: row.id,
      createdAt: row.sortAt,
      updatedAt: row.sortAt,
      __unified: row,
    };
  });
  const groups = groupByPersistedListDay(adapted as Array<CrewVoiceSessionInfo & { __unified: UnifiedCallRow }>);
  return groups.map((g) => ({
    dayKey: g.dayKey,
    label: g.label,
    items: g.items.map((item) => (item as { __unified: UnifiedCallRow }).__unified),
  }));
}
