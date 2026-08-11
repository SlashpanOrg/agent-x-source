import { describe, it, expect } from 'vitest';
import { EnhancedToolExecutor } from '../src/tools/EnhancedToolExecutor.js';
import { ToolRegistry } from '../src/tools/ToolRegistry.js';
import type { ToolDefinition } from '@agentx/shared';

/**
 * Regression test for the sub-agent NO_HANDLER bug: when a sub-agent is spawned
 * with an explicit allow-listed tool set, SmartSubAgent builds a fresh
 * EnhancedToolExecutor scoped to only those tools. copyExecutionPolicyFrom()
 * copies permission policy/hooks but NOT the actual handler function map — a
 * freshly constructed executor starts with zero registered handlers. Without
 * explicitly copying handlers across (via getHandlers()/registerHandler()),
 * every tool call the sub-agent makes fails with NO_HANDLER regardless of how
 * correctly the model calls the tool.
 *
 * Uses a low-risk non-deliverable tool id so proactive-consent policy does not
 * mask the NO_HANDLER path under test.
 */
describe('sub-agent child executor handler copying', () => {
  const TOOL_ID = 'probe_tool';

  const makeDef = (id: string): ToolDefinition => ({
    id,
    name: id,
    description: id,
    modelDescription: id,
    category: 'filesystem',
    riskLevel: 'low',
    schema: { type: 'object', properties: {} },
    composable: false,
    source: 'builtin',
  });

  it('copyExecutionPolicyFrom alone does NOT transfer handlers (documents the bug surface)', async () => {
    const parentRegistry = new ToolRegistry();
    parentRegistry.register(makeDef(TOOL_ID));
    const parentExecutor = new EnhancedToolExecutor(parentRegistry, '/tmp/parent-scope');
    parentExecutor.registerHandler(TOOL_ID, async () => ({ success: true, output: 'wrote file' }));

    // Simulate SmartSubAgent building a scoped child registry + fresh executor.
    const childRegistry = new ToolRegistry();
    childRegistry.register(parentRegistry.get(TOOL_ID)!);
    const childExecutor = new EnhancedToolExecutor(childRegistry, '/tmp/child-scope');
    childExecutor.copyExecutionPolicyFrom(parentExecutor);

    // Without copying handlers, the child executor has the tool *definition*
    // (so the LLM sees it in its schema) but no *handler* — this is the NO_HANDLER bug.
    const result = await childExecutor.execute(TOOL_ID, { path: 'a.txt', content: 'x' }, 'sub-session');
    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_HANDLER');
  });

  it('copying handlers via getHandlers()/registerHandler() fixes sub-agent tool execution', async () => {
    const parentRegistry = new ToolRegistry();
    parentRegistry.register(makeDef(TOOL_ID));
    const parentExecutor = new EnhancedToolExecutor(parentRegistry, '/tmp/parent-scope');
    parentExecutor.registerHandler(TOOL_ID, async () => ({ success: true, output: 'wrote file' }));

    const childRegistry = new ToolRegistry();
    childRegistry.register(parentRegistry.get(TOOL_ID)!);
    const childExecutor = new EnhancedToolExecutor(childRegistry, '/tmp/child-scope');
    childExecutor.copyExecutionPolicyFrom(parentExecutor);
    // The fix applied in SmartSubAgent.ts:
    for (const [name, handler] of parentExecutor.getHandlers()) {
      childExecutor.registerHandler(name, handler);
    }

    const result = await childExecutor.execute(TOOL_ID, { path: 'a.txt', content: 'x' }, 'sub-session');
    expect(result.success).toBe(true);
    expect(result.output).toBe('wrote file');
  });
});
