/**
 * AckTracker — forward-only message status transitions (Phase 4.4).
 *
 * WhatsApp delivers receipt acknowledgements (sent → delivered → read) as
 * separate events that can arrive out of order due to network latency or
 * multi-device sync. This tracker enforces forward-only transitions:
 * a message already marked `read` can never be downgraded back to `delivered`
 * or `sent` by a late-arriving ack.
 *
 * The status order is: pending < sent < delivered < read
 * `failed` is terminal — once a message fails, no further acks are accepted.
 *
 * Written from scratch — not copied from any reference project.
 */
import type { WhatsAppMessageStatus } from './engine/IWhatsAppEngine.js';

const STATUS_ORDER: Record<WhatsAppMessageStatus, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: -1, // terminal — special handling
};

/**
 * In-memory ack tracker. For a single-session system this is sufficient.
 * If we ever need persistence, the tracker can be extended to write through
 * to a `whatsapp_message_acks` table.
 */
export class AckTracker {
  private readonly statuses = new Map<string, WhatsAppMessageStatus>();

  /**
   * Attempt to transition a message to a new status.
   * @returns The effective status after the transition (may be the old status
   *          if the new one would be a downgrade).
   */
  transition(messageId: string, newStatus: WhatsAppMessageStatus): WhatsAppMessageStatus {
    const current = this.statuses.get(messageId);

    // First status for this message — accept it
    if (current === undefined) {
      this.statuses.set(messageId, newStatus);
      return newStatus;
    }

    // `failed` is terminal — no further transitions
    if (current === 'failed') {
      return current;
    }

    // Once `failed`, stays `failed`
    if (newStatus === 'failed') {
      this.statuses.set(messageId, 'failed');
      return 'failed';
    }

    // Forward-only: only accept if the new status is strictly higher
    const currentRank = STATUS_ORDER[current] ?? 0;
    const newRank = STATUS_ORDER[newStatus] ?? 0;

    if (newRank > currentRank) {
      this.statuses.set(messageId, newStatus);
      return newStatus;
    }

    // Downgrade rejected — return current status
    return current;
  }

  /** Get the current status for a message, or undefined if not tracked. */
  get(messageId: string): WhatsAppMessageStatus | undefined {
    return this.statuses.get(messageId);
  }

  /** Check if a transition would be accepted (for testing/debugging). */
  wouldAccept(messageId: string, newStatus: WhatsAppMessageStatus): boolean {
    const current = this.statuses.get(messageId);
    if (current === undefined) return true;
    if (current === 'failed') return false;
    if (newStatus === 'failed') return true;
    return (STATUS_ORDER[newStatus] ?? 0) > (STATUS_ORDER[current] ?? 0);
  }

  /** Clear all tracked statuses (used on session unlink). */
  clear(): void {
    this.statuses.clear();
  }

  /** Get the number of tracked messages (for diagnostics). */
  get size(): number {
    return this.statuses.size;
  }
}
