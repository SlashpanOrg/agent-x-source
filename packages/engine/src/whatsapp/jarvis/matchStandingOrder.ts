import { toNeutralJid } from '../identity/wa-id.js';
import type { StandingOrder, WorldEvent } from './standing-order-types.js';

function normalizeJidList(values: string[] | undefined): string[] {
  return (values ?? []).map((v) => toNeutralJid(v)).filter(Boolean);
}

/**
 * Score a standing order against a world event.
 * Exact JID > group id > keyword > catch-all. Returns 0 if it does not apply.
 */
export function scoreStandingOrder(order: StandingOrder, event: WorldEvent): number {
  if (!order.enabled) return 0;

  const chatKind = order.match.chatKind ?? 'any';
  if (chatKind === 'dm' && event.isGroup) return 0;
  if (chatKind === 'group' && !event.isGroup) return 0;

  const senders = normalizeJidList(order.match.senders);
  const groups = normalizeJidList(order.match.groups);
  const keywords = (order.match.keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean);

  const sender = toNeutralJid(event.senderJid);
  const chatId = toNeutralJid(event.chatId);
  const haystack = event.text.toLowerCase();

  let score = 0;
  let constrained = false;

  if (senders.length > 0) {
    constrained = true;
    if (!senders.includes(sender)) return 0;
    score += 100;
  }

  if (groups.length > 0) {
    constrained = true;
    if (!event.isGroup || !groups.includes(chatId)) return 0;
    score += 80;
  }

  if (keywords.length > 0) {
    constrained = true;
    if (!keywords.some((k) => haystack.includes(k))) return 0;
    score += 40;
  }

  if (chatKind !== 'any') score += 10;

  if (!constrained) score += 1;

  return score;
}

/** Highest-specificity enabled order, then higher `priority`, then older row. */
export function matchStandingOrder(
  orders: readonly StandingOrder[],
  event: WorldEvent,
): StandingOrder | null {
  let best: { order: StandingOrder; score: number } | null = null;
  for (const order of orders) {
    const score = scoreStandingOrder(order, event);
    if (score <= 0) continue;
    if (
      !best
      || score > best.score
      || (score === best.score && order.priority > best.order.priority)
    ) {
      best = { order, score };
    }
  }
  return best?.order ?? null;
}
