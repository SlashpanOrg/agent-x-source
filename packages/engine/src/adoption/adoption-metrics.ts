/** Lightweight adoption counters (observability hooks). */

const counters = new Map<string, number>();

export function incrementAdoptionMetric(name: string, delta = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + delta);
}

export function getAdoptionMetrics(): Record<string, number> {
  return Object.fromEntries(counters.entries());
}
