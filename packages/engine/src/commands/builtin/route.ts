import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';
import type { ModelRouter } from '../../session/ModelRouter.js';
import type { ProviderId } from '@agentx/shared';

let modelRouterInstance: ModelRouter | null = null;

export function setModelRouterInstance(router: ModelRouter): void {
  modelRouterInstance = router;
}

export function getModelRouterInstance(): ModelRouter | null {
  return modelRouterInstance;
}

export const routeCommand: CommandInterface = {
  name: 'route',
  description: 'View or configure model routing',
  usage: '/route | /route list | /route set <taskType> <provider> <model> | /route remove <taskType> <model>',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    const sub = args[0];

    if (!sub || sub === 'list') {
      if (!modelRouterInstance) {
        context.emit('Model router not available.');
        return { success: false, action: 'none' };
      }
      const routes = modelRouterInstance.getRoutes();
      const lines: string[] = ['Model routes:'];
      for (const [taskType, candidates] of routes) {
        const desc = candidates.map((r) => `${r.provider}/${r.model}`).join(', ');
        lines.push(`  ${taskType} → ${desc}`);
      }
      context.emit(lines.join('\n'));
      return { success: true, action: 'none' };
    }

    if (sub === 'set') {
      const taskType = args[1] as ModelRoutingTaskType;
      const provider = args[2] as ProviderId;
      const model = args[3];
      if (!taskType || !provider || !model) {
        context.emit('Usage: /route set <taskType> <provider> <model>');
        return { success: false, action: 'none' };
      }
      if (modelRouterInstance) {
        modelRouterInstance.setRoute(taskType, provider, model);
        context.emit(`Route set: ${taskType} → ${provider}/${model}`);
      }
      return { success: true, action: 'none' };
    }

    if (sub === 'remove') {
      const taskType = args[1] as ModelRoutingTaskType;
      const model = args[2];
      if (!taskType || !model) {
        context.emit('Usage: /route remove <taskType> <model>');
        return { success: false, action: 'none' };
      }
      if (modelRouterInstance) {
        modelRouterInstance.removeRoute(taskType, model);
        context.emit(`Route removed: ${taskType} → ${model}`);
      }
      return { success: true, action: 'none' };
    }

    context.emit('Usage: /route [list|set <taskType> <provider> <model>|remove <taskType> <model>]');
    return { success: false, action: 'none' };
  },
};

type ModelRoutingTaskType = 'chat' | 'code' | 'reasoning' | 'planning' | 'analysis' | 'creative' | 'fast' | 'cheap';
