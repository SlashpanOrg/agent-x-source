import type { MessagePart } from './message-parts.js';

/** Lift render_chart tool metadata into dedicated chart message parts.
 *  Charts are placed immediately after their corresponding tool call to
 *  preserve chronological ordering. */
export function attachChartPartsFromTools(
  parts: MessagePart[],
  toolCalls?: Array<{ id: string; name: string; metadata?: Record<string, unknown>; result?: string }>,
): MessagePart[] {
  let next = [...parts];
  const seen = new Set(next.filter((p) => p.type === 'chart').map((p) => p.id));

  const consider = (id: string, name: string, metadata?: Record<string, unknown>, result?: string) => {
    if (name !== 'render_chart' || seen.has(id)) return;
    const spec = metadata?.chartSpec;
    let chartJson: string | undefined;
    if (spec && typeof spec === 'object') {
      chartJson = JSON.stringify(spec);
    } else if (result) {
      const fence = result.match(/```chart\s*([\s\S]*?)```/i);
      if (fence?.[1]) chartJson = fence[1].trim();
    }
    if (!chartJson) return;
    seen.add(id);
    const chartPart: MessagePart = { type: 'chart', id, chartJson };
    // Insert chart immediately after its corresponding tool call to preserve
    // chronological ordering. If the tool isn't found in parts, append at end.
    const toolIdx = next.findIndex((p) => p.type === 'tool' && (p.tool?.id === id || p.id === id));
    if (toolIdx >= 0) {
      next = [...next.slice(0, toolIdx + 1), chartPart, ...next.slice(toolIdx + 1)];
    } else {
      next.push(chartPart);
    }
  };

  for (const p of parts) {
    if (p.type === 'tool' && p.tool?.name === 'render_chart') {
      consider(p.tool.id, p.tool.name, p.tool.metadata, p.tool.result);
    }
  }
  for (const t of toolCalls ?? []) {
    consider(t.id, t.name, t.metadata, t.result);
  }
  return next;
}
