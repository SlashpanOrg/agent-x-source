import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IntegrationAuditEntry } from '@agentx/shared';
import { getDataDir } from '@agentx/shared';

export class IntegrationAuditLog {
  private readonly logPath: string;

  constructor(baseDir?: string) {
    const dir = join(baseDir ?? getDataDir(), 'integrations');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.logPath = join(dir, 'audit.log');
  }

  append(entry: Omit<IntegrationAuditEntry, 'id' | 'timestamp'>): IntegrationAuditEntry {
    const full: IntegrationAuditEntry = {
      ...entry,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    // JSONL format — one JSON object per line. This preserves all fields
    // including connectionId, toolId, input, and output for the expandable
    // audit UI. Truncate input/output to 10KB each to prevent unbounded
    // log growth from large MCP responses.
    const logLine: IntegrationAuditEntry = {
      ...full,
      input: full.input ? full.input.slice(0, 10_000) : undefined,
      output: full.output ? full.output.slice(0, 10_000) : undefined,
    };
    appendFileSync(this.logPath, `${JSON.stringify(logLine)}\n`, 'utf-8');
    return full;
  }

  tail(limit = 100): IntegrationAuditEntry[] {
    if (!existsSync(this.logPath)) return [];
    const lines = readFileSync(this.logPath, 'utf-8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((line) => {
      try {
        return JSON.parse(line) as IntegrationAuditEntry;
      } catch {
        // Legacy tab-separated format — parse best-effort
        const [timestamp, providerId, toolName, mode, status, argsSummary, error] = line.split('\t');
        return {
          id: `${timestamp}:${toolName}`,
          timestamp: timestamp ?? '',
          connectionId: '',
          providerId: providerId ?? '',
          toolName: toolName ?? '',
          toolId: '',
          readonly: mode === 'READ',
          success: status === 'OK',
          argsSummary: argsSummary || undefined,
          error: error || undefined,
        };
      }
    });
  }
}
