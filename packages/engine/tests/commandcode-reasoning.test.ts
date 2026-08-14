import { describe, expect, it } from 'vitest';
import {
  COMMANDCODE_DEFAULT_REASONING_EFFORT,
  COMMANDCODE_REASONING_EFFORT_LEVELS,
  buildCommandCodeAiSdkProviderOptions,
  commandCodeBenchmarkReasoningEffort,
  resolveCommandCodeReasoningInfo,
  sanitizeCommandCodeReasoningEffort,
} from '../src/providers/commandcode/commandcode-metadata.js';

describe('sanitizeCommandCodeReasoningEffort', () => {
  it('accepts CommandCode wire enum values', () => {
    for (const level of COMMANDCODE_REASONING_EFFORT_LEVELS) {
      expect(sanitizeCommandCodeReasoningEffort(level)).toBe(level);
    }
  });

  it('omits none/minimal/empty so the API field is not sent', () => {
    expect(sanitizeCommandCodeReasoningEffort('none')).toBeUndefined();
    expect(sanitizeCommandCodeReasoningEffort('minimal')).toBeUndefined();
    expect(sanitizeCommandCodeReasoningEffort('')).toBeUndefined();
    expect(sanitizeCommandCodeReasoningEffort(undefined)).toBeUndefined();
  });

  it('rejects unknown levels', () => {
    expect(sanitizeCommandCodeReasoningEffort('turbo')).toBeUndefined();
  });
});

describe('resolveCommandCodeReasoningInfo', () => {
  it('exposes selectable levels for provider-specific UI', () => {
    const info = resolveCommandCodeReasoningInfo('gpt-5.6-terra');
    expect(info.supported).toBe(true);
    expect(info.effortLevels).toEqual([...COMMANDCODE_REASONING_EFFORT_LEVELS]);
    expect(info.defaultEffort).toBe(COMMANDCODE_DEFAULT_REASONING_EFFORT);
    expect(info.control).toBe('reasoning_effort');
  });
});

describe('commandCodeBenchmarkReasoningEffort', () => {
  it('uses UI selection when valid', () => {
    expect(commandCodeBenchmarkReasoningEffort('high')).toBe('high');
  });

  it('falls back to low when UI sends none or nothing', () => {
    expect(commandCodeBenchmarkReasoningEffort('none')).toBe('low');
    expect(commandCodeBenchmarkReasoningEffort(undefined)).toBe('low');
  });
});

describe('buildCommandCodeAiSdkProviderOptions', () => {
  it('emits commandcode.reasoningEffort for valid levels', () => {
    expect(buildCommandCodeAiSdkProviderOptions('medium')).toEqual({
      commandcode: { reasoningEffort: 'medium' },
    });
  });

  it('omits options for none so CommandCode never receives an invalid enum', () => {
    expect(buildCommandCodeAiSdkProviderOptions('none')).toBeUndefined();
  });
});
