import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getLogger, getConfigDir } from '@agentx/shared';

export interface TurnOutcome {
  sessionId: string;
  turnId: string;
  category: string;
  sub?: string;
  phase: string;
  toolChoice: string;
  allowedTools?: string[];
  stepCap: number;
  toolsUsed: string[];
  toolCallCount: number;
  filesRead: number;
  filesWritten: number;
  buildsRun: number;
  buildsPassed: number;
  buildsFailed: number;
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  success: boolean;
  durationMs: number;
  timestamp: number;
  model?: string;
}

export interface PolicyAdjustment {
  category: string;
  sub?: string;
  suggestedStepCap?: number;
  suggestedToolChoice?: 'auto' | 'none' | 'required';
  suggestedAllowedTools?: string[];
  reason: string;
  confidence: number;
}

interface ToolStats {
  toolId: string;
  totalCalls: number;
  successCount: number;
  failureCount: number;
  avgDurationMs: number;
}

interface ToolComboStats {
  toolSet: string; // sorted, joined
  totalTurns: number;
  successCount: number;
  avgToolCalls: number;
}

/**
 * Logs turn outcomes to a persistent JSONL file and learns from them
 * to suggest policy adjustments.
 *
 * Features:
 * - Per-tool success rate tracking (which tools fail most?)
 * - Time-weighted decay (recent outcomes matter more)
 * - Automatic policy application (not just suggestions)
 * - Per-model tracking (different models need different policies)
 * - Tool combination analysis (which tool sets succeed?)
 */
export class TurnFeedbackLogger {
  private logPath: string;
  private outcomes: TurnOutcome[] = [];
  private maxLogEntries = 2000;
  private modelId: string;
  private autoAppliedAdjustments = new Map<string, PolicyAdjustment>();

  constructor(_sessionId: string, modelId?: string) {
    const configDir = getConfigDir();
    const logDir = join(configDir, 'feedback');
    try {
      if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    } catch {
      // Directory creation may fail in sandboxed environments
    }
    this.logPath = join(logDir, 'turn-outcomes.jsonl');
    this.modelId = modelId ?? 'unknown';
    this.loadPastOutcomes();
  }

  setModelId(modelId: string): void {
    this.modelId = modelId;
  }

  log(outcome: TurnOutcome): void {
    // Attach model if not set
    if (!outcome.model) outcome.model = this.modelId;

    this.outcomes.push(outcome);
    if (this.outcomes.length > this.maxLogEntries) {
      this.outcomes = this.outcomes.slice(-this.maxLogEntries);
    }

    try {
      if (existsSync(dirname(this.logPath))) {
        writeFileSync(this.logPath, JSON.stringify(outcome) + '\n', { flag: 'a' });
      }
    } catch {
      // File write may fail — in-memory tracking still works
    }

    // Auto-apply adjustments if enough data has accumulated
    this.maybeAutoApply();
  }

  /**
   * Analyze past outcomes and suggest policy adjustments.
   * Uses time-weighted decay: recent outcomes have higher weight.
   */
  getSuggestedAdjustments(): PolicyAdjustment[] {
    if (this.outcomes.length < 5) return [];

    // Filter to current model if we have model data
    const modelOutcomes = this.outcomes.filter((o) => o.model === this.modelId);
    const relevantOutcomes = modelOutcomes.length >= 5 ? modelOutcomes : this.outcomes;

    const byCategory = new Map<string, TurnOutcome[]>();
    for (const o of relevantOutcomes) {
      const key = o.sub ? `${o.category}:${o.sub}` : o.category;
      const arr = byCategory.get(key) ?? [];
      arr.push(o);
      byCategory.set(key, arr);
    }

    const adjustments: PolicyAdjustment[] = [];
    const now = Date.now();
    const DECAY_HALF_LIFE = 7 * 24 * 60 * 60 * 1000; // 7 days

    for (const [key, outcomes] of byCategory) {
      if (outcomes.length < 3) continue;

      // Time-weighted success rate
      let totalWeight = 0;
      let weightedSuccess = 0;
      let weightedToolCalls = 0;
      for (const o of outcomes) {
        const age = now - o.timestamp;
        const weight = Math.exp(-age / DECAY_HALF_LIFE);
        totalWeight += weight;
        weightedSuccess += (o.success ? 1 : 0) * weight;
        weightedToolCalls += o.toolCallCount * weight;
      }
      const successRate = weightedSuccess / totalWeight;
      const avgToolCalls = weightedToolCalls / totalWeight;

      const [category, sub] = key.includes(':') ? key.split(':') : [key, undefined];

      // Low success rate + high tool calls → more restrictive
      if (successRate < 0.5 && avgToolCalls > 5) {
        adjustments.push({
          category,
          sub: sub || undefined,
          suggestedStepCap: Math.max(3, Math.floor(avgToolCalls * 0.5)),
          suggestedToolChoice: 'auto',
          reason: `Success rate ${Math.round(successRate * 100)}% with avg ${avgToolCalls.toFixed(1)} tool calls — reducing step cap`,
          confidence: Math.min(outcomes.length / 10, 1),
        });
      }

      // High success rate + low tool calls → can relax
      if (successRate > 0.9 && avgToolCalls < 2) {
        adjustments.push({
          category,
          sub: sub || undefined,
          suggestedStepCap: Math.ceil(avgToolCalls * 2),
          reason: `Success rate ${Math.round(successRate * 100)}% with avg ${avgToolCalls.toFixed(1)} tool calls — can relax step cap`,
          confidence: Math.min(outcomes.length / 10, 1),
        });
      }

      // Build failures without retries → increase step cap for debug
      if (outcomes.some((o) => o.buildsFailed > 0 && o.buildsRun < 2)) {
        adjustments.push({
          category,
          sub: sub || undefined,
          suggestedStepCap: 15,
          reason: `Build failures detected without retry — increasing step cap for build-fix loop`,
          confidence: 0.6,
        });
      }
    }

    if (adjustments.length > 0) {
      getLogger().info('FEEDBACK', `Suggested ${adjustments.length} policy adjustments from ${relevantOutcomes.length} outcomes (model: ${this.modelId})`);
    }

    return adjustments;
  }

  /**
   * Get per-tool success rates — identifies which tools fail most often.
   */
  getToolStats(): ToolStats[] {
    const toolMap = new Map<string, ToolStats>();

    for (const o of this.outcomes) {
      for (const toolId of o.toolsUsed) {
        const stats = toolMap.get(toolId) ?? {
          toolId,
          totalCalls: 0,
          successCount: 0,
          failureCount: 0,
          avgDurationMs: 0,
        };
        stats.totalCalls++;
        if (o.success) stats.successCount++;
        else stats.failureCount++;
        stats.avgDurationMs = (stats.avgDurationMs * (stats.totalCalls - 1) + o.durationMs) / stats.totalCalls;
        toolMap.set(toolId, stats);
      }
    }

    return [...toolMap.values()].sort((a, b) => b.failureCount - a.failureCount);
  }

  /**
   * Get tool combination analysis — which tool sets succeed most?
   */
  getToolComboStats(): ToolComboStats[] {
    const comboMap = new Map<string, ToolComboStats>();

    for (const o of this.outcomes) {
      if (o.toolsUsed.length === 0) continue;
      const key = [...o.toolsUsed].sort().join(',');
      const stats = comboMap.get(key) ?? {
        toolSet: key,
        totalTurns: 0,
        successCount: 0,
        avgToolCalls: 0,
      };
      stats.totalTurns++;
      if (o.success) stats.successCount++;
      stats.avgToolCalls = (stats.avgToolCalls * (stats.totalTurns - 1) + o.toolCallCount) / stats.totalTurns;
      comboMap.set(key, stats);
    }

    return [...comboMap.values()].sort((a, b) => b.totalTurns - a.totalTurns);
  }

  /**
   * Get the best-performing tool set for a given category.
   */
  getBestToolSetForCategory(category: string, sub?: string): string[] | null {
    const key = sub ? `${category}:${sub}` : category;
    const matching = this.outcomes.filter((o) =>
      (o.sub ? `${o.category}:${o.sub}` : o.category) === key && o.success,
    );
    if (matching.length < 2) return null;

    // Find the tool set with highest success rate
    const comboMap = new Map<string, { count: number; success: number }>();
    for (const o of matching) {
      const toolKey = [...o.toolsUsed].sort().join(',');
      const stats = comboMap.get(toolKey) ?? { count: 0, success: 0 };
      stats.count++;
      if (o.success) stats.success++;
      comboMap.set(toolKey, stats);
    }

    let bestSet: string[] | null = null;
    let bestRate = 0;
    for (const [toolKey, stats] of comboMap) {
      if (stats.count < 2) continue;
      const rate = stats.success / stats.count;
      if (rate > bestRate) {
        bestRate = rate;
        bestSet = toolKey.split(',');
      }
    }
    return bestSet;
  }

  /**
   * Get auto-applied adjustment for a specific category/sub.
   * Returns the adjustment if it exists and confidence is high enough.
   */
  getAutoAppliedAdjustment(category: string, sub?: string): PolicyAdjustment | null {
    const key = sub ? `${category}:${sub}` : category;
    return this.autoAppliedAdjustments.get(key) ?? null;
  }

  private maybeAutoApply(): void {
    // Only auto-apply every 10 outcomes to avoid thrashing
    if (this.outcomes.length % 10 !== 0) return;

    const adjustments = this.getSuggestedAdjustments();
    for (const adj of adjustments) {
      if (adj.confidence > 0.7) {
        const key = adj.sub ? `${adj.category}:${adj.sub}` : adj.category;
        const existing = this.autoAppliedAdjustments.get(key);
        if (!existing || adj.confidence > existing.confidence) {
          this.autoAppliedAdjustments.set(key, adj);
          getLogger().info('FEEDBACK', `Auto-applied adjustment for ${key}: ${adj.reason}`);
        }
      }
    }
  }

  private loadPastOutcomes(): void {
    try {
      if (!existsSync(this.logPath)) return;
      const content = readFileSync(this.logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      this.outcomes = lines.slice(-this.maxLogEntries).map((line) => {
        try {
          return JSON.parse(line) as TurnOutcome;
        } catch {
          return null;
        }
      }).filter((o): o is TurnOutcome => o !== null);
      if (this.outcomes.length > 0) {
        getLogger().info('FEEDBACK', `Loaded ${this.outcomes.length} past turn outcomes for policy tuning`);
      }
    } catch {
      // File read failed — start with empty history
    }
  }
}
