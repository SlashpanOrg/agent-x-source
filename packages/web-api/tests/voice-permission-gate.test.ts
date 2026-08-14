import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PermissionHandlerResult } from '@agentx/shared';
import {
  VOICE_PERMISSION_CLARIFY_LINE,
  VOICE_PERMISSION_COLLECT_MS,
  VOICE_PERMISSION_MAX_CLARIFY,
  VOICE_PERMISSION_TIMEOUT_MS,
} from '../../shared/src/utils/voice-permission.js';
import {
  VoicePermissionGate,
  buildVoicePermissionSpokenPrompt,
} from '../src/voice-permission-gate.js';
import { summarizePermissionArgs } from '../../engine/src/agent/agent-helpers.js';

describe('buildVoicePermissionSpokenPrompt', () => {
  it('asks about a single tool', () => {
    expect(buildVoicePermissionSpokenPrompt([
      { requestId: '1', tool: 'write_file', riskLevel: 'high', argsSummary: 'write plan.md' },
    ], 'Nova')).toBe('Nova needs to write plan.md. This includes a higher-risk action. Should I go ahead?');
  });

  it('batches several tools into one spoken ask', () => {
    const line = buildVoicePermissionSpokenPrompt([
      { requestId: '1', tool: 'write_file', riskLevel: 'medium', argsSummary: 'write plan.md' },
      { requestId: '2', tool: 'shell_exec', riskLevel: 'high', argsSummary: 'run a command' },
    ], 'Nova');
    expect(line).toContain('Nova needs a few tools');
    expect(line).toContain('write plan.md');
    expect(line).toContain('run a command');
    expect(line).toContain('higher-risk');
    expect(line).toContain('all of them');
  });
});

describe('summarizePermissionArgs spoken URLs', () => {
  it('speaks domain and title instead of the full URL', () => {
    const { argsSummary, commandPreview } = summarizePermissionArgs({
      url: 'https://images.pexels.com/photos/123456/pexels-photo-123456.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
      title: 'BMW M3',
      kind: 'image',
    });
    expect(commandPreview).toContain('pexels.com');
    expect(argsSummary).toBe('open BMW M3 from pexels.com');
    expect(argsSummary).not.toContain('https://');
    expect(argsSummary).not.toContain('123456');
  });

  it('falls back to the root domain when there is no title', () => {
    const { argsSummary } = summarizePermissionArgs({
      url: 'https://images.pexels.com/photos/123456/pexels-photo-123456.jpeg?auto=compress',
      kind: 'image',
    });
    expect(argsSummary).toBe('open an image from pexels.com');
    expect(argsSummary).not.toMatch(/https?:\/\//);
    expect(argsSummary).not.toContain('123456');
  });
});

describe('VoicePermissionGate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function createGate() {
    const spoken: string[] = [];
    const gate = new VoicePermissionGate({
      speak: async (line) => { spoken.push(line); },
      agentName: () => 'Nova',
    });
    return { gate, spoken };
  }

  it('collects concurrent tools into one prompt and allows on natural yes', async () => {
    vi.useFakeTimers();
    const { gate, spoken } = createGate();
    const results: PermissionHandlerResult[] = [];
    gate.add(
      { requestId: '1', tool: 'write_file', riskLevel: 'high', argsSummary: 'write plan.md' },
      (r) => { results.push(r); },
    );
    gate.add(
      { requestId: '2', tool: 'shell_exec', riskLevel: 'high', argsSummary: 'run a command' },
      (r) => { results.push(r); },
    );

    await vi.advanceTimersByTimeAsync(VOICE_PERMISSION_COLLECT_MS + 20);
    expect(spoken).toHaveLength(1);
    expect(spoken[0]).toContain('few tools');

    await gate.handleUtterance('yes go ahead');
    expect(results).toEqual(['allow_once', 'allow_once']);
    expect(gate.pending).toBe(false);
  });

  it('clarifies once then denies after too many unclear replies', async () => {
    vi.useFakeTimers();
    const { gate, spoken } = createGate();
    let result: PermissionHandlerResult | undefined;
    gate.add(
      { requestId: '1', tool: 'write_file', riskLevel: 'medium', argsSummary: 'write plan.md' },
      (r) => { result = r; },
    );

    await vi.advanceTimersByTimeAsync(VOICE_PERMISSION_COLLECT_MS + 20);
    await gate.handleUtterance('hmm');
    expect(spoken.at(-1)).toBe(VOICE_PERMISSION_CLARIFY_LINE);

    for (let i = 0; i < VOICE_PERMISSION_MAX_CLARIFY; i += 1) {
      await gate.handleUtterance('maybe later perhaps');
    }
    expect(result).toEqual(expect.objectContaining({ type: 'instruct' }));
    expect(gate.pending).toBe(false);
  });

  it('times out without a spoken confirmation', async () => {
    vi.useFakeTimers();
    const { gate } = createGate();
    let result: PermissionHandlerResult | undefined;
    gate.add(
      { requestId: '1', tool: 'write_file', riskLevel: 'medium', argsSummary: 'write plan.md' },
      (r) => { result = r; },
    );

    await vi.advanceTimersByTimeAsync(VOICE_PERMISSION_COLLECT_MS + 20);
    await vi.advanceTimersByTimeAsync(VOICE_PERMISSION_TIMEOUT_MS + 20);
    expect(result).toEqual(expect.objectContaining({ type: 'instruct' }));
    expect(gate.pending).toBe(false);
  });

  it('applies a yes spoken during the collect window', async () => {
    vi.useFakeTimers();
    const { gate, spoken } = createGate();
    let result: PermissionHandlerResult | undefined;
    gate.add(
      { requestId: '1', tool: 'write_file', riskLevel: 'medium', argsSummary: 'write plan.md' },
      (r) => { result = r; },
    );

    const consumed = await gate.handleUtterance('yes');
    expect(consumed).toBe(true);
    await vi.advanceTimersByTimeAsync(VOICE_PERMISSION_COLLECT_MS + 20);
    expect(result).toBe('allow_once');
    expect(spoken).toHaveLength(0);
  });
});
