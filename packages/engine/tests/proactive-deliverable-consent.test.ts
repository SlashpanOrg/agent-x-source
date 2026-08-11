import { describe, expect, it } from 'vitest';
import {
  detectsExplicitDeliverableRequest,
  detectsSessionProactiveConsentWaiver,
  isProactiveDeliverableTool,
  proactiveDeliverableConsentInstruction,
} from '../src/services/tool/proactive-deliverable-consent.js';

describe('proactive-deliverable-consent', () => {
  it('flags deliverable tools', () => {
    expect(isProactiveDeliverableTool('save_to_markdown')).toBe(true);
    expect(isProactiveDeliverableTool('web_search')).toBe(false);
  });

  it('detects session waivers', () => {
    expect(detectsSessionProactiveConsentWaiver("don't ask me for permission, just carry on")).toBe(true);
    expect(detectsSessionProactiveConsentWaiver('please analyse this carefully')).toBe(false);
  });

  it('detects explicit save/create requests', () => {
    expect(detectsExplicitDeliverableRequest('Save this analysis to markdown')).toBe(true);
    expect(detectsExplicitDeliverableRequest('What is TVK known for?')).toBe(false);
  });

  it('returns a plain-text ask instruction', () => {
    const text = proactiveDeliverableConsentInstruction('save_to_markdown');
    expect(text).toMatch(/plain-text question/i);
    expect(text).toMatch(/STOP this turn/i);
    expect(text).toMatch(/Do not use ask_clarification/i);
  });
});
