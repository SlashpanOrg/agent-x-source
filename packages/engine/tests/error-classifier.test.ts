import { describe, it, expect } from 'vitest';
import { ErrorClassifier } from '../src/communication/ErrorClassifier.js';
import { FailoverReason } from '@agentx/shared';

describe('ErrorClassifier', () => {
  const classifier = new ErrorClassifier();

  it('classifies 401 as AUTH error', () => {
    const result = classifier.classify({ status: 401, message: 'Unauthorized' });
    expect(result.reason).toBe(FailoverReason.AUTH);
    expect(result.retryable).toBe(true);
    expect(result.shouldRotateCredential).toBe(true);
  });

  it('classifies 429 as RATE_LIMIT', () => {
    const result = classifier.classify({ status: 429, message: 'Too many requests' });
    expect(result.reason).toBe(FailoverReason.RATE_LIMIT);
    expect(result.shouldFallback).toBe(true);
  });

  it('classifies 500 as SERVER_ERROR', () => {
    const result = classifier.classify({ status: 500 });
    expect(result.reason).toBe(FailoverReason.SERVER_ERROR);
  });

  it('classifies 503 as OVERLOADED', () => {
    const result = classifier.classify({ status: 503 });
    expect(result.reason).toBe(FailoverReason.OVERLOADED);
  });

  it('classifies 402 as BILLING', () => {
    const result = classifier.classify({ status: 402 });
    expect(result.reason).toBe(FailoverReason.BILLING);
  });

  it('classifies context overflow from message', () => {
    const result = classifier.classify(new Error('context length exceeded'));
    expect(result.reason).toBe(FailoverReason.CONTEXT_OVERFLOW);
    expect(result.shouldCompress).toBe(true);
  });

  it('classifies rate limit from message', () => {
    const result = classifier.classify(new Error('rate limit reached'));
    expect(result.reason).toBe(FailoverReason.RATE_LIMIT);
  });

  it('classifies invalid API key from message', () => {
    const result = classifier.classify(new Error('invalid api key'));
    expect(result.reason).toBe(FailoverReason.AUTH);
  });

  it('classifies timeout from message', () => {
    const result = classifier.classify(new Error('ETIMEDOUT'));
    expect(result.reason).toBe(FailoverReason.TIMEOUT);
  });

  it('classifies content filter as POLICY_BLOCK', () => {
    const result = classifier.classify(new Error('content filter triggered'));
    expect(result.reason).toBe(FailoverReason.POLICY_BLOCK);
    expect(result.retryable).toBe(false);
  });

  it('defaults unknown errors to UNKNOWN with retryable', () => {
    const result = classifier.classify(new Error('something went wrong'));
    expect(result.reason).toBe(FailoverReason.UNKNOWN);
    expect(result.retryable).toBe(true);
    expect(result.shouldFallback).toBe(true);
  });

  it('classifies model not found', () => {
    const result = classifier.classify(new Error('model not found'));
    expect(result.reason).toBe(FailoverReason.MODEL_NOT_FOUND);
  });

  it('classifies format/malformed errors', () => {
    const result = classifier.classify(new Error('invalid json'));
    expect(result.reason).toBe(FailoverReason.FORMAT);
  });
});
