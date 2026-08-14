import type { MessagePart } from './message-parts.js';
import { parseVisualItem } from './visual-item.js';
import type { VisualItem } from '../types/visual.js';

export function attachVisualPartsFromTools(
  parts: MessagePart[],
  toolCalls?: Array<{ id: string; name: string; metadata?: Record<string, unknown>; result?: string }>,
): MessagePart[] {
  let next = [...parts];
  const seen = new Set(next.filter((p) => p.type === 'visual').map((p) => p.id));

  const consider = (id: string, name: string, metadata?: Record<string, unknown>) => {
    if (name !== 'present_visual' || seen.has(id)) return;
    const item = parseVisualItem(metadata?.visualItem);
    if (!item) return;
    seen.add(id);
    const visualPart: MessagePart = { type: 'visual', id, visual: item };
    const toolIdx = next.findIndex((p) => p.type === 'tool' && (p.tool?.id === id || p.id === id));
    if (toolIdx >= 0) {
      next = [...next.slice(0, toolIdx + 1), visualPart, ...next.slice(toolIdx + 1)];
    } else {
      next.push(visualPart);
    }
  };

  for (const p of parts) {
    if (p.type === 'tool' && p.tool?.name === 'present_visual') {
      consider(p.tool.id, p.tool.name, p.tool.metadata);
    }
  }
  for (const t of toolCalls ?? []) {
    consider(t.id, t.name, t.metadata);
  }
  return next;
}

export function visualItemFromPart(part: MessagePart): VisualItem | null {
  if (part.type !== 'visual') return null;
  return parseVisualItem(part.visual);
}
