import { describe, expect, it } from 'vitest';
import {
  formatBenchmarkAbortError,
  isProviderAccessOrNetworkError,
} from '../src/benchmark/probe-errors.js';

describe('isProviderAccessOrNetworkError', () => {
  it('aborts on HTTP 400 bad request so the suite does not continue', () => {
    const err = new Error(
      'OpenAI API error: 400 - {"error":{"message":"Invalid option: expected one of \\"low\\"|\\"medium\\"","type":"invalid_request_error","param":"reasoning_effort"}}',
    );
    expect(isProviderAccessOrNetworkError(err)).toBe(true);
  });

  it('aborts on invalid_request without an explicit status code', () => {
    expect(isProviderAccessOrNetworkError(new Error('invalid_request_error: bad params'))).toBe(true);
  });

  it('still aborts on auth failures', () => {
    expect(isProviderAccessOrNetworkError(new Error('OpenAI API error: 401 - unauthorized'))).toBe(true);
  });

  it('does not abort on capability-style failures', () => {
    expect(isProviderAccessOrNetworkError(new Error('Model does not support vision'))).toBe(false);
  });
});

describe('formatBenchmarkAbortError', () => {
  it('surfaces the provider message from a 400 body', () => {
    const msg = formatBenchmarkAbortError(
      new Error(
        'OpenAI API error: 400 - {"error":{"message":"Invalid option: expected one of \\"low\\"","type":"invalid_request_error","param":"reasoning_effort"}}',
      ),
    );
    expect(msg.toLowerCase()).toContain('invalid option');
  });
});
