import { describe, it, expect } from 'vitest';
import { redactAttributes, redactText } from '../../src/observability/redact.js';

describe('redactAttributes', () => {
  it('redacts llm.input_messages when capturePrompts=false', () => {
    const attrs = { 'llm.input_messages': [{ role: 'user', content: 'secret prompt' }] };
    const out = redactAttributes(attrs, false);
    expect(out['llm.input_messages']).toBe('[redacted:43]');
  });

  it('redacts llm.output_messages when capturePrompts=false', () => {
    const attrs = { 'llm.output_messages': [{ role: 'assistant', content: 'response' }] };
    const out = redactAttributes(attrs, false);
    expect(out['llm.output_messages']).toBe('[redacted:43]');
  });

  it('redacts tool.args when capturePrompts=false', () => {
    const attrs = { 'tool.args': { query: 'sensitive data' } };
    const out = redactAttributes(attrs, false);
    expect(out['tool.args']).toBe('[redacted:26]');
  });

  it('redacts tool.output when capturePrompts=false', () => {
    const attrs = { 'tool.output': 'some output' };
    const out = redactAttributes(attrs, false);
    expect(out['tool.output']).toBe('[redacted:11]');
  });

  it('redacts retrieval.query when capturePrompts=false', () => {
    const attrs = { 'retrieval.query': 'search term' };
    const out = redactAttributes(attrs, false);
    expect(out['retrieval.query']).toBe('[redacted:11]');
  });

  it('redacts user.text when capturePrompts=false', () => {
    const attrs = { 'user.text': 'my secret message' };
    const out = redactAttributes(attrs, false);
    expect(out['user.text']).toBe('[redacted:17]');
  });

  it('redacts retrieval.documents content but keeps score when capturePrompts=false', () => {
    const attrs = { 'retrieval.documents': [{ content: 'doc content', score: 0.95, metadata: { page: 1 } }] };
    const out = redactAttributes(attrs, false);
    const docs = out['retrieval.documents'] as Array<{ content: string; score: number; metadata: unknown }>;
    expect(docs[0]!.content).toBe('[redacted:11]');
    expect(docs[0]!.score).toBe(0.95);
    expect(docs[0]!.metadata).toEqual({ page: 1 });
  });

  it('preserves token counts when capturePrompts=false', () => {
    const attrs = {
      'gen_ai.usage.input_tokens': 100,
      'gen_ai.usage.output_tokens': 50,
      'gen_ai.usage.total_tokens': 150,
      'llm.token_count.input': 100,
    };
    const out = redactAttributes(attrs, false);
    expect(out['gen_ai.usage.input_tokens']).toBe(100);
    expect(out['gen_ai.usage.output_tokens']).toBe(50);
    expect(out['gen_ai.usage.total_tokens']).toBe(150);
    expect(out['llm.token_count.input']).toBe(100);
  });

  it('preserves tool names, durations, statuses when capturePrompts=false', () => {
    const attrs = {
      'tool.name': 'web_search',
      'tool.success': true,
      'tool.elapsed_ms': 500,
      'duration_ms': 1000,
      'status': 'ok',
    };
    const out = redactAttributes(attrs, false);
    expect(out['tool.name']).toBe('web_search');
    expect(out['tool.success']).toBe(true);
    expect(out['tool.elapsed_ms']).toBe(500);
  });

  it('preserves gen_ai.request.max_tokens (not PII)', () => {
    const attrs = { 'gen_ai.request.max_tokens': 4096 };
    const out = redactAttributes(attrs, false);
    expect(out['gen_ai.request.max_tokens']).toBe(4096);
  });

  it('does NOT redact when capturePrompts=true', () => {
    const attrs = { 'llm.input_messages': [{ role: 'user', content: 'secret' }] };
    const out = redactAttributes(attrs, true);
    expect(out['llm.input_messages']).toEqual([{ role: 'user', content: 'secret' }]);
  });

  it('always scrubs secret keys regardless of capturePrompts', () => {
    const attrs = {
      'apiKey': 'sk-12345',
      'api_key': 'sk-67890',
      'Authorization': 'Bearer token',
      'token': 'abc',
      'password': 'secret',
      'config.apiKey': 'sk-xyz',
    };
    const out = redactAttributes(attrs, true);
    expect(out['apiKey']).toBe('[secret]');
    expect(out['api_key']).toBe('[secret]');
    expect(out['Authorization']).toBe('[secret]');
    expect(out['token']).toBe('[secret]');
    expect(out['password']).toBe('[secret]');
  });

  it('scrubs nested secret keys in objects', () => {
    const attrs = { 'config': { apiKey: 'sk-nested', other: 'keep' } };
    const out = redactAttributes(attrs, true);
    const config = out['config'] as Record<string, unknown>;
    expect(config['apiKey']).toBe('[secret]');
    expect(config['other']).toBe('keep');
  });
});

describe('redactText', () => {
  it('redacts text when capturePrompts=false', () => {
    expect(redactText('hello world', false)).toBe('[redacted:11]');
  });

  it('preserves text when capturePrompts=true', () => {
    expect(redactText('hello world', true)).toBe('hello world');
  });

  it('handles undefined', () => {
    expect(redactText(undefined, false)).toBeUndefined();
    expect(redactText(undefined, true)).toBeUndefined();
  });

  it('handles empty string (falsy → returned as-is)', () => {
    expect(redactText('', false)).toBe('');
    expect(redactText('', true)).toBe('');
  });
});
