import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

export const agentsCommand: CommandInterface = {
  name: 'agents',
  description: 'List active sub-agents',
  usage: '/agents',
  async execute(_args: string[], context: CommandContext): Promise<CommandResult> {
    let subAgentManager: { getAll(): Array<{ id: string; instruction: string; status: string; startTime?: number }> } | null = null;
    try {
      const mod = await import('../../tools/builtin/subagent.js');
      subAgentManager = (mod as unknown as { getSubAgentManagerInstance: () => typeof subAgentManager }).getSubAgentManagerInstance?.() ?? null;
    } catch {
      // fallthrough
    }

    if (!subAgentManager) {
      context.emit('Sub-agent manager not available.');
      return { success: false, action: 'none' };
    }

    const all = subAgentManager.getAll();
    if (all.length === 0) {
      context.emit('No active sub-agents.');
      return { success: true, action: 'none' };
    }

    const lines = all.map((t) => {
      const elapsed = t.startTime ? Math.round((Date.now() - t.startTime) / 1000) : 0;
      return `  [${t.status}] ${t.id.slice(0, 8)} — "${t.instruction.slice(0, 60)}" — ${elapsed}s`;
    });
    context.emit(`Sub-agents:\n${lines.join('\n')}`);
    return { success: true, action: 'none' };
  },
};
