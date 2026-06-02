import type { CompactionSummary, Message } from '@agentx/shared';

export class CompactionSummarizer {
  async summarize(
    head: Message[],
    _tail: Message[],
  ): Promise<CompactionSummary> {
    const content = head.map((m) => m.content).join('\n');

    const goals = this.extractGoals(content);
    const decisions = this.extractDecisions(content);
    const files = this.extractFiles(content);

    return {
      goal: goals[0] ?? 'Unknown',
      constraints: '',
      done: [],
      inProgress: [],
      blocked: [],
      keyDecisions: decisions,
      nextSteps: [],
      criticalContext: [],
      relevantFiles: files,
    };
  }

  static formatSummary(summary: CompactionSummary): string {
    const lines: string[] = [
      '## Context Summary',
      'This is a REFERENCE summary, not active instructions.',
      '',
      '## Active Task',
      summary.goal || '(none)',
      '',
      '## Constraints',
      summary.constraints || '(none)',
      '',
      '## Done (completed tasks)',
      ...(summary.done.length > 0
        ? summary.done.map((d) => `- ${d}`)
        : ['- (none)']),
      '',
      '## In Progress',
      ...(summary.inProgress.length > 0
        ? summary.inProgress.map((p) => `- ${p}`)
        : ['- (none)']),
      '',
      '## Blocked',
      ...(summary.blocked.length > 0
        ? summary.blocked.map((b) => `- ${b}`)
        : ['- (none)']),
      '',
      '## Key Decisions',
      ...(summary.keyDecisions.length > 0
        ? summary.keyDecisions.map((d) => `- ${d}`)
        : ['- (none)']),
      '',
      '## Next Steps',
      ...(summary.nextSteps.length > 0
        ? summary.nextSteps.map((s) => `- ${s}`)
        : ['- (none)']),
      '',
      '## Critical Context',
      ...(summary.criticalContext.length > 0
        ? summary.criticalContext.map((c) => `- ${c}`)
        : ['- (none)']),
      '',
      '## Relevant Files',
      ...(summary.relevantFiles.length > 0
        ? summary.relevantFiles.map((f) => `- ${f}`)
        : ['- (none)']),
    ];

    return lines.join('\n');
  }

  private extractGoals(content: string): string[] {
    const goals: string[] = [];
    const patterns = [
      /(?:goal|objective|task|i need to|i want to|let me|i'll)\s+([^.!?\n]+)[.!?]?/gi,
      /(?:the user wants? to|the user asks? to|request(?:ed|ing)?:)\s+([^.!?\n]+)[.!?]?/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const goal = match[1]?.trim();
        if (goal && goal.length > 5) goals.push(goal);
      }
    }

    return goals;
  }

  private extractDecisions(content: string): string[] {
    const decisions: string[] = [];
    const pattern =
      /(?:decided|decision|choose|chose|resolved|concluded)\s+(?:to\s+)?([^.!?\n]+)[.!?]?/gi;

    let match;
    while ((match = pattern.exec(content)) !== null) {
      const decision = match[1]?.trim();
      if (decision && decision.length > 3) decisions.push(decision);
    }

    return decisions.slice(0, 10);
  }

  private extractFiles(content: string): string[] {
    const files = new Set<string>();
    const patterns = [
      /(?:file|path|read|write|edit|open|create|delete)[sd]?\s+[`'"]?([\w./\-~]+\.\w+)[`'"]?/gi,
      /[`'"]?([\w./\-~]+\.(?:ts|tsx|js|jsx|py|rs|go|java|rb|php|json|md|yaml|yml|toml|csv))[`'"]?/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const file = match[1]?.trim();
        if (file && !file.startsWith(' ') && !files.has(file)) {
          files.add(file);
        }
      }
    }

    return Array.from(files).slice(0, 20);
  }
}
