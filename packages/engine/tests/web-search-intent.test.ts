import { describe, it, expect } from 'vitest';
import {
  analyzeWebSearchIntentHeuristic,
  isScheduledTaskRequest,
} from '../src/search/web-search-intent.js';

describe('web-search-intent scheduling', () => {
  it('detects scheduled/reminder requests', () => {
    expect(isScheduledTaskRequest('update me with bangalore news around 12:56 PM today')).toBe(true);
    expect(isScheduledTaskRequest('remind me in 5 minutes to drink water')).toBe(true);
    expect(isScheduledTaskRequest('what is the latest news about bangalore right now')).toBe(false);
  });

  it('does not force web search for scheduled tasks', () => {
    const intent = analyzeWebSearchIntentHeuristic(
      'update me with latest news about bangalore in few lines around 12:56PM today',
    );
    expect(intent.shouldForceSearch).toBe(false);
    expect(intent.reason).toMatch(/scheduled|reminder|defer/i);
  });

  it('still forces search for immediate news queries', () => {
    const intent = analyzeWebSearchIntentHeuristic('what is the latest bangalore news right now');
    expect(intent.shouldForceSearch).toBe(true);
  });

  it('forces live search for shopping and booking requests', () => {
    expect(analyzeWebSearchIntentHeuristic('find the best price for a cordless vacuum').shouldForceSearch).toBe(true);
    expect(analyzeWebSearchIntentHeuristic('book a hotel in Lisbon for next weekend').shouldForceSearch).toBe(true);
  });

  it('does not mistake product engineering language for shopping', () => {
    expect(analyzeWebSearchIntentHeuristic('design a product API for our platform').shouldForceSearch).toBe(false);
    expect(analyzeWebSearchIntentHeuristic('book a meeting with the finance team').shouldForceSearch).toBe(false);
  });
});
