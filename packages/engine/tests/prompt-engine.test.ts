import { describe, it, expect } from 'vitest';
import { PromptEngine } from '../src/prompt/PromptEngine.js';

describe('PromptEngine', () => {
  const engine = new PromptEngine(128000);

  it('detects code intent', () => {
    const result = engine.detectIntent('Refactor the authentication module to use JWT');
    expect(result.intent).toBe('code');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('detects research intent', () => {
    const result = engine.detectIntent('Research the best database for this use case');
    expect(result.intent).toBe('research');
  });

  it('detects file system intent', () => {
    const result = engine.detectIntent('Create a new directory structure for the project');
    expect(result.intent).toBe('file_system');
  });

  it('calculates budget with reserves', () => {
    const budget = engine.calculateBudget(10, true);
    expect(budget.system).toBeGreaterThan(0);
    expect(budget.conversation).toBeGreaterThan(0);
    expect(budget.system + budget.conversation).toBeLessThan(128000);
  });

  it('selects relevant tools for intent', () => {
    const tools = [
      { function: { name: 'file_write', description: 'Write file', parameters: {} } },
      { function: { name: 'shell_exec', description: 'Execute shell', parameters: {} } },
      { function: { name: 'web_search', description: 'Search web', parameters: {} } },
    ];
    const intent = engine.detectIntent('Write a new config file');
    const selected = engine.selectTools(tools, intent, new Map([['file_write', 'filesystem']]));
    expect(selected.length).toBeGreaterThan(0);
  });

  it('estimates tokens from text', () => {
    const tokens = engine.estimateTokens('Hello world');
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThanOrEqual(5);
  });
});
