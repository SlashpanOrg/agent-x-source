/**
 * Trace bundle renderers (§9.7.3).
 *
 * Two formats:
 *   - `renderTraceBundleJson(bundle)`  — pretty-printed JSON (machine-readable, primary for AI agents).
 *   - `renderTraceBundleMarkdown(bundle)` — structured Markdown doc (human + AI readable).
 *
 * The Markdown template (Appendix D of the plan):
 *   # Agent-X Trace <traceId>
 *   ## Summary         — trace metadata table
 *   ## Diagnosis       — root cause, error messages, chain of events, suggestions
 *   ## Span Tree       — indented list with kind/duration/status (emoji-coded)
 *   ## Spans (Detail)  — per-span attributes (prompt/response for llm, args/output for tool)
 *   ## Logs            — timestamp/level/scope/message table
 *   ## Metrics         — metric samples in the window
 *   ## Environment     — agent-x version, provider, model, config snapshot
 */
import type {
  SpanNode,
  TraceExportBundle,
} from '@agentx/shared';

/** Render the bundle as pretty-printed JSON. */
export function renderTraceBundleJson(bundle: TraceExportBundle): string {
  return JSON.stringify(bundle, null, 2);
}

/** Render the bundle as a structured Markdown document. */
export function renderTraceBundleMarkdown(bundle: TraceExportBundle): string {
  const lines: string[] = [];
  const t = bundle.trace;
  const statusBadge = statusEmoji(t.status);

  lines.push(`# Agent-X Trace \`${t.trace_id}\``);
  lines.push('');
  lines.push(`> Status: ${statusBadge} \`${t.status}\` | Domain: \`${t.domain}\` | Kind: \`${t.kind}\``);
  lines.push('');

  // ── Summary ───────────────────────────────────────────────────────────────
  lines.push('## Summary');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Trace ID | \`${t.trace_id}\` |`);
  lines.push(`| Domain | \`${t.domain}\` |`);
  lines.push(`| Kind | \`${t.kind}\` |`);
  if (t.session_id) lines.push(`| Session ID | \`${t.session_id}\` |`);
  if (t.turn_id) lines.push(`| Turn ID | \`${t.turn_id}\` |`);
  lines.push(`| Status | ${statusBadge} \`${t.status}\` |`);
  lines.push(`| Started | ${t.started_at} |`);
  if (t.ended_at) lines.push(`| Ended | ${t.ended_at} |`);
  if (t.duration_ms != null) lines.push(`| Duration | ${t.duration_ms} ms |`);
  if (t.provider) lines.push(`| Provider | \`${t.provider}\` |`);
  if (t.model) lines.push(`| Model | \`${t.model}\` |`);
  if (t.input_tokens != null || t.output_tokens != null) {
    lines.push(`| Tokens | in=${t.input_tokens ?? 0} out=${t.output_tokens ?? 0} |`);
  }
  if (t.cost_usd) lines.push(`| Cost | $${t.cost_usd.toFixed(6)} |`);
  lines.push(`| Tool calls | ${t.tool_call_count} |`);
  if (t.error) lines.push(`| Error | ${escapeMd(t.error)} |`);
  if (t.user_text_preview) lines.push(`| User text | ${escapeMd(t.user_text_preview)} |`);
  lines.push('');

  // ── Diagnosis ─────────────────────────────────────────────────────────────
  lines.push('## Diagnosis');
  lines.push('');
  const d = bundle.diagnosis;
  if (d.root_cause_span) {
    lines.push(`**Root cause span:** \`${d.root_cause_span.name}\` (kind: \`${d.root_cause_span.kind}\`, depth: deepest failing span)`);
    lines.push('');
  }
  if (d.error_messages.length > 0) {
    lines.push('**Error messages:**');
    lines.push('');
    for (const msg of d.error_messages) {
      lines.push(`- ${escapeMd(msg)}`);
    }
    lines.push('');
  }
  if (d.chain_of_events.length > 0) {
    lines.push('**Chain of events (root → root cause):**');
    lines.push('');
    for (let i = 0; i < d.chain_of_events.length; i++) {
      lines.push(`${i + 1}. ${escapeMd(d.chain_of_events[i]!)}`);
    }
    lines.push('');
  }
  if (d.token_usage) {
    lines.push(`**Token usage:** in=${d.token_usage.input} out=${d.token_usage.output} total=${d.token_usage.total}`);
    lines.push('');
  }
  if (d.tool_calls.length > 0) {
    lines.push('**Tool calls:**');
    lines.push('');
    lines.push('| Tool | Success | Elapsed (ms) |');
    lines.push('| --- | --- | --- |');
    for (const tc of d.tool_calls) {
      lines.push(`| \`${tc.name}\` | ${tc.success ? 'yes' : 'no'} | ${tc.elapsed_ms} |`);
    }
    lines.push('');
  }
  if (d.suggested_investigation.length > 0) {
    lines.push('**Suggested investigation:**');
    lines.push('');
    for (const s of d.suggested_investigation) {
      lines.push(`- ${escapeMd(s)}`);
    }
    lines.push('');
  }

  // ── Span Tree (Waterfall) ─────────────────────────────────────────────────
  lines.push('## Span Tree (Waterfall)');
  lines.push('');
  lines.push('```');
  renderSpanTreeLines(bundle.spans, 0, lines);
  lines.push('```');
  lines.push('');

  // ── Spans (Detail) ────────────────────────────────────────────────────────
  lines.push('## Spans (Detail)');
  lines.push('');
  const flatSpans = flattenSpans(bundle.spans);
  for (const s of flatSpans) {
    lines.push(`### ${statusEmoji(s.status)} \`${s.name}\` (kind: \`${s.kind}\`, status: \`${s.status}\`)`);
    lines.push('');
    lines.push(`- Span ID: \`${s.span_id}\``);
    if (s.parent_span_id) lines.push(`- Parent: \`${s.parent_span_id}\``);
    lines.push(`- Started: ${s.started_at}${s.ended_at ? ` | Ended: ${s.ended_at}` : ''}`);
    if (s.duration_ms != null) lines.push(`- Duration: ${s.duration_ms} ms`);
    if (Object.keys(s.attributes).length > 0) {
      lines.push('- Attributes:');
      lines.push('```json');
      lines.push(JSON.stringify(s.attributes, null, 2));
      lines.push('```');
    }
    if (s.events.length > 0) {
      lines.push('- Events:');
      for (const ev of s.events) {
        lines.push(`  - \`${ev.name}\` @ ${ev.timestamp}`);
        if (ev.attributes && Object.keys(ev.attributes).length > 0) {
          lines.push('    ```json');
          lines.push(JSON.stringify(ev.attributes, null, 2));
          lines.push('    ```');
        }
      }
    }
    lines.push('');
  }

  // ── Logs ──────────────────────────────────────────────────────────────────
  if (bundle.logs.length > 0) {
    lines.push('## Logs');
    lines.push('');
    lines.push('| Timestamp | Level | Scope | Message |');
    lines.push('| --- | --- | --- | --- |');
    for (const l of bundle.logs) {
      lines.push(`| ${l.ts} | \`${l.level}\` | ${l.scope ?? ''} | ${escapeMd(l.message)} |`);
    }
    lines.push('');
  }

  // ── Metrics ───────────────────────────────────────────────────────────────
  if (bundle.metrics.length > 0) {
    lines.push('## Metrics');
    lines.push('');
    lines.push('| Timestamp | Name | Value | Labels |');
    lines.push('| --- | --- | --- | --- |');
    for (const m of bundle.metrics) {
      lines.push(`| ${new Date(m.timestamp ?? 0).toISOString()} | \`${m.name}\` | ${m.value} | ${JSON.stringify(m.labels ?? {})} |`);
    }
    lines.push('');
  }

  // ── Environment ───────────────────────────────────────────────────────────
  lines.push('## Environment');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Agent-X version | \`${bundle.environment.agentx_version}\` |`);
  lines.push(`| Provider | \`${bundle.environment.provider}\` |`);
  lines.push(`| Model | \`${bundle.environment.model}\` |`);
  lines.push('| Config (redacted) |');
  lines.push('```json');
  lines.push(JSON.stringify(bundle.environment.config_redacted, null, 2));
  lines.push('```');
  lines.push('');

  // ── Footer ────────────────────────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push(`Exported by Agent-X Observability at ${bundle.exported_at} | schema_version: ${bundle.schema_version}`);
  lines.push('');

  return lines.join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusEmoji(status: string): string {
  switch (status) {
    case 'ok': return '🟢';
    case 'error': return '🔴';
    case 'cancelled': return '🟡';
    case 'running': return '🔵';
    case 'unset': return '⚪';
    default: return '⚪';
  }
}

function renderSpanTreeLines(spans: SpanNode[], depth: number, lines: string[]): void {
  for (const s of spans) {
    const indent = '  '.repeat(depth);
    const dur = s.duration_ms != null ? ` (${s.duration_ms}ms)` : '';
    lines.push(`${indent}${statusEmoji(s.status)} [${s.kind}] ${s.name}${dur} ${s.status}`);
    renderSpanTreeLines(s.children, depth + 1, lines);
  }
}

function flattenSpans(spans: SpanNode[]): SpanNode[] {
  const out: SpanNode[] = [];
  const walk = (nodes: SpanNode[]): void => {
    for (const n of nodes) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(spans);
  return out;
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
