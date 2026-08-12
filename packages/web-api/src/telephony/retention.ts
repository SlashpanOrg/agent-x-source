import { getLogger } from '@agentx/shared';
import { getVoiceCallStore, TERMINAL_CALL_SESSION_STATES } from '@agentx/engine';

const DEFAULT_EVENT_RETENTION_DAYS = 90;
const DEFAULT_RECORDING_REF_DAYS = 30;
const DEFAULT_MISSION_ARCHIVE_DAYS = 180;

/**
 * Configurable retention/deletion for call domain (H4.12).
 * Safe to run periodically; no-ops when store is empty.
 */
export async function runVoiceCallRetentionJob(options?: {
  eventRetentionDays?: number;
  recordingRefDays?: number;
  missionArchiveDays?: number;
}): Promise<{ eventsPurged: number; recordingRefsCleared: number; missionsArchived: number }> {
  const eventDays = options?.eventRetentionDays ?? DEFAULT_EVENT_RETENTION_DAYS;
  const recordingDays = options?.recordingRefDays ?? DEFAULT_RECORDING_REF_DAYS;
  const missionDays = options?.missionArchiveDays ?? DEFAULT_MISSION_ARCHIVE_DAYS;
  const store = getVoiceCallStore();
  const now = Date.now();

  let eventsPurged = 0;
  let recordingRefsCleared = 0;
  let missionsArchived = 0;

  const sessions = await store.listSessions({});
  for (const session of sessions) {
    // Clear old recording refs (keep metadata)
    if (session.recordingRef && session.endedAt) {
      const ended = Date.parse(session.endedAt);
      if (!Number.isNaN(ended) && now - ended > recordingDays * 86_400_000) {
        await store.saveSession({ ...session, recordingRef: null });
        recordingRefsCleared += 1;
      }
    }

    // Purge events for terminal sessions older than retention
    if (
      TERMINAL_CALL_SESSION_STATES.has(session.state) &&
      session.endedAt &&
      now - Date.parse(session.endedAt) > eventDays * 86_400_000
    ) {
      // In-memory store: re-save session; event purge via store helper if present
      const anyStore = store as { purgeEventsForSession?: (id: string) => Promise<number> };
      if (typeof anyStore.purgeEventsForSession === 'function') {
        eventsPurged += await anyStore.purgeEventsForSession(session.id);
      }
    }
  }

  const missions = await store.listMissions({});
  for (const mission of missions) {
    if (!['completed', 'failed', 'cancelled'].includes(mission.status)) continue;
    const updated = Date.parse(mission.updatedAt);
    if (!Number.isNaN(updated) && now - updated > missionDays * 86_400_000) {
      // Soft-archive: mark cancelled if somehow still not terminal naming
      await store.saveMission({
        ...mission,
        status: mission.status === 'completed' ? 'completed' : mission.status,
        systemContext: undefined,
        updatedAt: new Date().toISOString(),
      });
      missionsArchived += 1;
    }
  }

  getLogger().info('VOICE_CALL_RETENTION', 'Retention job finished', {
    eventsPurged,
    recordingRefsCleared,
    missionsArchived,
  });

  return { eventsPurged, recordingRefsCleared, missionsArchived };
}

let retentionTimer: ReturnType<typeof setInterval> | null = null;

export function startVoiceCallRetentionScheduler(intervalMs = 6 * 60 * 60 * 1000): void {
  if (retentionTimer) return;
  retentionTimer = setInterval(() => {
    void runVoiceCallRetentionJob().catch((err) => {
      getLogger().error('VOICE_CALL_RETENTION_FAILED', err);
    });
  }, intervalMs);
  if (typeof retentionTimer.unref === 'function') retentionTimer.unref();
}

export function stopVoiceCallRetentionScheduler(): void {
  if (retentionTimer) {
    clearInterval(retentionTimer);
    retentionTimer = null;
  }
}
