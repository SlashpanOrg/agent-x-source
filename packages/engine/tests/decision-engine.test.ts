import { describe, it, expect } from 'vitest';
import { DecisionEngine } from '../src/agent/DecisionEngine.js';

describe('DecisionEngine', () => {
  const engine = new DecisionEngine();

  it('classifies greeting as fast_reply', () => {
    const result = engine.classify('Hey there!', 1);
    expect(result.messageClass).toBe('greeting');
    expect(result.executionPath).toBe('fast_reply');
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('classifies farewell as fast_reply', () => {
    const result = engine.classify('Goodbye, thanks for the help!', 1);
    expect(result.messageClass).toBe('farewell');
    expect(result.executionPath).toBe('fast_reply');
  });

  it('classifies conversational short messages as fast_reply', () => {
    const result = engine.classify('okay got it', 2);
    expect(result.executionPath).toBe('fast_reply');
  });

  it('classifies simple questions as standard', () => {
    const result = engine.classify('What is the weather today?', 1);
    expect(result.executionPath).toBe('standard');
  });

  it('classifies complex tasks as orchestrated or multi_agent', () => {
    const result = engine.classify('Build a complete microservice application with authentication', 1);
    expect(['orchestrated', 'multi_agent']).toContain(result.executionPath);
  });

  it('classifies research queries', () => {
    const result = engine.classify('Research the best practices for Kubernetes deployment strategies and compare them', 1);
    expect(result.executionPath).toBeDefined();
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('provides reasoning for decisions', () => {
    const result = engine.classify('Create a full MERN stack application', 1);
    expect(result.reasoning).toBeTruthy();
    expect(result.reasoning.length).toBeGreaterThan(0);
  });

});
