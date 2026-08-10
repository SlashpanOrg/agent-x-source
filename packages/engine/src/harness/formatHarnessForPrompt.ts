import type { HarnessEntry, HarnessKind } from '@agentx/shared';

const DEFAULT_ENTRY_LIMIT = 6;
const DEFAULT_CONTENT_LIMIT = 180;

export function formatHarnessForPrompt(
  localEntries: HarnessEntry[],
  globalEntries: HarnessEntry[],
  options?: { entryLimit?: number; contentLimit?: number },
): string {
  const entryLimit = options?.entryLimit ?? DEFAULT_ENTRY_LIMIT;
  const contentLimit = options?.contentLimit ?? DEFAULT_CONTENT_LIMIT;

  const lines: string[] = [
    'CONTINUAL HARNESS (supplemental — base system rules remain immutable):',
    'Use entries as routing hints. Invoke skills/subagents by reference when relevant.',
  ];

  const renderGroup = (label: string, entries: HarnessEntry[]) => {
    if (entries.length === 0) return;
    lines.push(`\n[${label}]`);
    const slice = entries.slice(0, entryLimit);
    for (const e of slice) {
      const content =
        e.content.length > contentLimit
          ? `${e.content.slice(0, contentLimit)}…`
          : e.content;
      lines.push(`- (${e.kind}) ${e.title}: ${content}`);
      if (e.path) lines.push(`  path: ${e.path}`);
      if (e.reference && Object.keys(e.reference).length > 0) {
        lines.push(`  ref: ${JSON.stringify(e.reference)}`);
      }
      if (e.kind === 'skill') {
        const execName = e.reference?.executableSkill ?? e.reference?.name ?? e.reference?.skill;
        if (typeof execName === 'string' && execName) {
          lines.push(`  executable_skill: ${execName} (use executable_skill_run or executable_skill_load)`);
        }
      }
    }
    if (entries.length > entryLimit) {
      lines.push(`  … ${entries.length - entryLimit} more entries omitted`);
    }
  };

  const byKind = (entries: HarnessEntry[], kind: HarnessKind) =>
    entries.filter((e) => e.kind === kind);

  const allLocal = localEntries;
  const allGlobal = globalEntries;

  for (const kind of ['memory', 'prompt', 'skill', 'subagent'] as HarnessKind[]) {
    const local = byKind(allLocal, kind);
    const global = byKind(allGlobal, kind);
    if (local.length) renderGroup(`session ${kind}`, local);
    if (global.length) renderGroup(`global ${kind}`, global);
  }

  if (localEntries.length === 0 && globalEntries.length === 0) {
    return '';
  }

  return lines.join('\n');
}
