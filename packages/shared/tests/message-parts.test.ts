import { describe, it, expect } from 'vitest';
import { sanitizeForJson, stripToolNoise, decodeLiteralUnicodeEscapes } from '../src/utils/text-sanitize.js';
import {
  assignPartsToAssistantMessage,
  appendThinkingDeltaToParts,
  buildPartsFromDbRows,
  dedupeResponseDocumentParts,
  normalizeMessageForUi,
  partsCorruptedByCrossTurn,
  partsTextTruncatesContent,
  sealTrailingThinkingPart,
  shouldRebuildStoredParts,
  syncTextPartsWithCanonicalContent,
  collapseOverlappingTextParts,
  suppressOverlappingAssistantTexts,
  isSettledPersistedTurn,
  partsIndicateRunningTools,
  textFromAssistantRecord,
} from '../src/utils/message-parts.js';

describe('text-sanitize', () => {
  it('replaces lone surrogates', () => {
    const bad = 'hello \uD800 world';
    expect(sanitizeForJson(bad)).toBe('hello \uFFFD world');
  });

  it('strips tool noise from content', () => {
    const noisy = 'Here is the plan.\n🔧 Calling: file_write({})\n✅ Result: (no output)\nDone.';
    expect(stripToolNoise(noisy)).toBe('Here is the plan.\nDone.');
  });

  it('decodes literal \\uXXXX escapes and strips zero-width chars', () => {
    const raw = 'Bangalore-registered + a TN office/\\u200cbranch/correspondence address on file';
    expect(stripToolNoise(raw)).toBe(
      'Bangalore-registered + a TN office/branch/correspondence address on file',
    );
    expect(decodeLiteralUnicodeEscapes('use \\u0041 and \\u{1F4A1}')).toBe('use A and \u{1F4A1}');
    // Preserve escapes inside fenced code
    expect(decodeLiteralUnicodeEscapes('before\n```\n\\u200c\n```\nafter')).toBe('before\n```\n\\u200c\n```\nafter');
  });

  it('never leaves invisible escape spellings in prose, but keeps them in code', () => {
    expect(stripToolNoise('A &#x200c; B &zwnj; C U+200C D')).toBe('A  B  C  D');
    expect(stripToolNoise('see `\\u200c` and ```\n\\u200c\n``` please')).toBe(
      'see `\\u200c` and ```\n\\u200c\n``` please',
    );
    // Nested escaping
    expect(stripToolNoise('x\\\\u200cy')).toBe('xy');
  });
});

describe('message-parts', () => {
  it('preserves spaces across text-delta chunks', () => {
    const parts = buildPartsFromDbRows([
      { type: 'text-delta', content: "You're " },
      { type: 'text-delta', content: 'good to go!' },
    ]);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.content).toBe("You're good to go!");
  });

  it('preserves word boundaries split across deltas', () => {
    const parts = buildPartsFromDbRows([
      { type: 'text-delta', content: 'Found' },
      { type: 'text-delta', content: ' it! Let me' },
    ]);
    expect(parts[0]?.content).toBe('Found it! Let me');
  });

  it('builds chronological parts from db rows', () => {
    const parts = buildPartsFromDbRows([
      { type: 'text-delta', content: 'Hello world' },
      { type: 'tool-call', tool_call_id: 't1', tool_name: 'glob' },
      { type: 'tool-result', tool_call_id: 't1', tool_name: 'glob', tool_result: 'ok', tool_success: 1 },
    ]);
    expect(parts.some((p) => p.type === 'text' && p.content === 'Hello world')).toBe(true);
    expect(parts.some((p) => p.type === 'tool' && p.tool?.name === 'glob')).toBe(true);
  });

  it('dedupes duplicate tool-call rows and finalizes status', () => {
    const parts = buildPartsFromDbRows([
      { type: 'tool-call', tool_call_id: 't1', tool_name: 'glob' },
      { type: 'tool-call', tool_call_id: 't1', tool_name: 'glob' },
      { type: 'tool-result', tool_call_id: 't1', tool_name: 'glob', tool_result: 'ok', tool_success: 1 },
    ]);
    expect(parts.filter((p) => p.type === 'tool')).toHaveLength(1);
    expect(parts.find((p) => p.type === 'tool')?.tool?.status).toBe('done');
  });

  it('detects cross-turn parts corruption', () => {
    const turn1Lead = "I'll provide you with a comprehensive analysis of TTS and STT models for your use case.";
    const turn2Content = 'Absolutely. Let me assess your current workspace and propose a practical integration architecture.';
    const corruptedParts = [
      { type: 'text' as const, id: '1', content: turn1Lead },
      { type: 'text' as const, id: '2', content: turn2Content },
    ];
    expect(partsCorruptedByCrossTurn(turn2Content, corruptedParts)).toBe(true);
    expect(partsCorruptedByCrossTurn(turn1Lead, [{ type: 'text', id: '1', content: turn1Lead }])).toBe(false);
  });

  it('normalizeMessageForUi drops corrupted stored parts and uses content', () => {
    const turn1Lead = "I'll provide you with a comprehensive analysis of TTS and STT.";
    const turn2Content = 'Absolutely. Let me assess your current workspace and propose integration.';
    const result = normalizeMessageForUi({
      role: 'assistant',
      content: turn2Content,
      parts: [
        { type: 'text', id: '1', content: turn1Lead },
        { type: 'text', id: '2', content: turn2Content },
      ],
    }, []);
    expect(result.content).toBe(turn2Content);
    expect(result.parts?.filter((p) => p.type === 'text')).toHaveLength(1);
    expect(result.parts?.some((p) => p.type === 'text' && p.content?.includes(turn1Lead))).toBe(false);
  });

  it('assignPartsToAssistantMessage uses turn window after previous user message', () => {
    const messages = [
      { role: 'user', created_at: '2026-06-23T17:40:37.699Z' },
      { role: 'assistant', created_at: '2026-06-23T17:40:53.518Z' },
      { role: 'user', created_at: '2026-06-23T17:41:00.000Z' },
      { role: 'assistant', created_at: '2026-06-23T17:47:48.951Z' },
    ];
    const allParts = [
      { type: 'text-delta', content: 'turn1', created_at: '2026-06-23T17:40:40.000Z' },
      { type: 'text-delta', content: 'turn2', created_at: '2026-06-23T17:41:05.000Z' },
    ];
    const turn1Parts = assignPartsToAssistantMessage(messages, allParts, 1);
    const turn2Parts = assignPartsToAssistantMessage(messages, allParts, 3);
    expect(turn1Parts).toHaveLength(1);
    expect(turn1Parts[0]?.content).toBe('turn1');
    expect(turn2Parts).toHaveLength(1);
    expect(turn2Parts[0]?.content).toBe('turn2');
  });

  it('rebuilds assistant 1 when parts tools exceed toolCalls (merged turns)', () => {
    const turn1Content = "I'll provide you with a comprehensive analysis of TTS and STT models.";
    const result = normalizeMessageForUi({
      role: 'assistant',
      content: turn1Content,
      parts: [
        { type: 'text', id: '1', content: turn1Content },
        { type: 'tool', id: 't1', tool: { id: 't1', name: 'web_search', status: 'done' } },
        { type: 'tool', id: 't2', tool: { id: 't2', name: 'folder_tree', status: 'done' } },
      ],
      toolCalls: [{ id: 't1', name: 'web_search', status: 'done' }],
    }, []);
    expect(result.parts?.filter((p) => p.type === 'tool')).toHaveLength(1);
    expect(result.parts?.find((p) => p.type === 'tool')?.tool?.name).toBe('web_search');
  });

  it('preserves questionnaire-only stored parts on restore', () => {
    const result = normalizeMessageForUi({
      role: 'assistant',
      content: '',
      parts: [{
        type: 'questionnaire',
        id: 'q1',
        questionnaire: {
          payload: { id: 'q1', questions: [{ id: 'a', prompt: 'Which?', type: 'text' }] },
          status: 'answered',
          answer: 'Which?: React',
        },
      }],
    });
    expect(result.parts?.some((p) => p.type === 'questionnaire')).toBe(true);
  });

  it('preserves a valid response document when canonical text is stored separately', () => {
    const result = normalizeMessageForUi({
      role: 'assistant',
      content: 'Canonical textual answer',
      parts: [{
        type: 'response_document',
        id: 'rich-1',
        responseDocument: {
          version: 1,
          title: 'Analysis',
          blocks: [{
            type: 'callout',
            tone: 'success',
            title: 'Verdict',
            content: 'The upgrade is feasible.',
          }],
        },
      }],
    });
    const rich = result.parts?.find((p) => p.type === 'response_document');
    expect(rich?.responseDocument?.title).toBe('Analysis');
    expect(rich?.fallbackMarkdown).toContain('# Analysis');
    expect(result.content).toBe('Canonical textual answer');
  });

  it('falls back to canonical text for an invalid response document', () => {
    const result = normalizeMessageForUi({
      role: 'assistant',
      content: 'Canonical textual answer',
      parts: [{
        type: 'response_document',
        id: 'rich-invalid',
        responseDocument: {
          version: 1,
          blocks: [{ type: 'iframe', src: 'https://example.com' }],
        },
      }],
    });
    expect(result.parts?.some((p) => p.type === 'response_document')).toBe(false);
    expect(result.parts?.some((p) => p.type === 'text' && p.content === 'Canonical textual answer')).toBe(true);
  });

  it('keeps the latest response document for a stable part id', () => {
    const base = {
      version: 1 as const,
      blocks: [{ type: 'text' as const, content: 'First' }],
    };
    const parts = dedupeResponseDocumentParts([
      { type: 'response_document', id: 'rich-1', responseDocument: base },
      { type: 'thinking', id: 'thought-1', content: 'Done.' },
      {
        type: 'response_document',
        id: 'rich-1',
        responseDocument: {
          ...base,
          blocks: [{ type: 'text', content: 'Latest' }],
        },
      },
    ]);
    expect(parts.filter((p) => p.type === 'response_document')).toHaveLength(1);
    expect(parts.find((p) => p.type === 'response_document')?.responseDocument?.blocks[0]).toMatchObject({
      content: 'Latest',
    });
  });

  it('ignores a stale response document snapshot revision', () => {
    const parts = dedupeResponseDocumentParts([
      {
        type: 'response_document',
        id: 'rich-1',
        responseDocument: {
          version: 1,
          revision: 4,
          blocks: [{ type: 'text', content: 'Current' }],
        },
      },
      {
        type: 'response_document',
        id: 'rich-1',
        responseDocument: {
          version: 1,
          revision: 3,
          blocks: [{ type: 'text', content: 'Stale' }],
        },
      },
    ]);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.responseDocument?.revision).toBe(4);
    expect(parts[0]?.responseDocument?.blocks[0]).toMatchObject({ content: 'Current' });
  });

  it('restores a rich document after a serialized process boundary', () => {
    const stored = JSON.parse(JSON.stringify({
      id: 'assistant-restart-1',
      sessionId: 'session-1',
      role: 'assistant',
      content: '# Restored report\n\nCanonical answer.',
      parts: [{
        type: 'response_document',
        id: 'response-assistant-restart-1',
        fallbackMarkdown: '# Restored report\n\nCanonical answer.',
        responseDocument: {
          version: 1,
          revision: 2,
          density: 'compact',
          title: 'Restored report',
          blocks: [{ type: 'text', content: 'Canonical answer.' }],
        },
      }],
    })) as Parameters<typeof normalizeMessageForUi>[0];
    const restored = normalizeMessageForUi(stored);
    const rich = restored.parts?.find((part) => part.type === 'response_document');
    expect(rich?.responseDocument?.revision).toBe(2);
    expect(rich?.fallbackMarkdown).toContain('Canonical answer');
  });

  it('restores thinking from metadata and reasoning-delta rows', () => {
    const fromMeta = normalizeMessageForUi({
      role: 'assistant',
      content: 'Final answer',
      metadata: { thinking: 'I should check the files first.' },
    });
    expect(fromMeta.thinking).toBe('I should check the files first.');
    expect(fromMeta.parts?.filter((p) => p.type === 'thinking')).toHaveLength(1);

    const fromRows = normalizeMessageForUi(
      { role: 'assistant', content: 'Final answer' },
      [
        { type: 'reasoning-delta', content: 'Step one. ' },
        { type: 'reasoning-delta', content: 'Step two.' },
      ],
    );
    expect(fromRows.thinking).toBe('Step one. Step two.');
    expect(fromRows.parts?.filter((p) => p.type === 'thinking')).toHaveLength(1);
  });

  it('keeps separate thinking parts around tools in chronological order', () => {
    const result = normalizeMessageForUi(
      { role: 'assistant', content: 'Done' },
      [
        { type: 'reasoning-delta', content: 'Plan A. ' },
        { type: 'tool-call', tool_call_id: 't1', tool_name: 'shell_exec', tool_args: '{}' },
        { type: 'tool-result', tool_call_id: 't1', tool_result: 'ok', tool_success: 1 },
        { type: 'reasoning-delta', content: 'Plan B.' },
        { type: 'text-delta', content: 'Done' },
      ],
    );
    const types = (result.parts ?? []).map((p) => p.type);
    expect(types).toEqual(['thinking', 'tool', 'thinking', 'text']);
    expect(result.parts?.[0]?.content).toBe('Plan A. ');
    expect(result.parts?.[2]?.content).toBe('Plan B.');
  });

  it('restores subagent parts from message_parts and metadata', () => {
    const fromRows = normalizeMessageForUi(
      { role: 'assistant', content: 'Done' },
      [{
        type: 'subagent',
        tool_call_id: 'child-1',
        content: 'Research competitors',
        tool_args: JSON.stringify({ name: 'Sub-Agent', status: 'done', kind: 'sub_agent' }),
        tool_result: 'Found three.',
        tool_success: 1,
      }],
    );
    expect(fromRows.parts?.some((p) => p.type === 'subagent' && p.agent?.id === 'child-1')).toBe(true);
    expect(fromRows.subAgents?.[0]?.task).toBe('Research competitors');

    const fromMeta = normalizeMessageForUi({
      role: 'assistant',
      content: 'Done',
      metadata: {
        subAgents: [{ id: 'child-2', name: 'Sub-Agent', task: 'Draft outline', status: 'done' }],
      },
    });
    expect(fromMeta.subAgents?.[0]?.id).toBe('child-2');
    expect(fromMeta.parts?.some((p) => p.type === 'subagent' && p.agent?.id === 'child-2')).toBe(true);
  });

  it('preserves chronological order when partsTextExceedsContent (no cross-turn corruption)', () => {
    // Simulate the live streaming case: parts have interleaved text/tools in
    // chronological order, but the combined text length slightly exceeds the
    // canonical content field (common due to streaming accumulation differences).
    // The fix should preserve the stored parts' chronological ordering instead
    // of rebuilding from canonical (which would merge all text into one block).
    const text1 = 'Let me check that for you.';
    const text2 = 'Here are the results.';
    const result = normalizeMessageForUi({
      role: 'assistant',
      content: text2, // canonical content is shorter than combined parts text
      parts: [
        { type: 'text', id: 't1', content: text1 },
        { type: 'tool', id: 'tool1', tool: { id: 'tool1', name: 'web_search', status: 'done' } },
        { type: 'text', id: 't2', content: text2 },
      ],
      toolCalls: [{ id: 'tool1', name: 'web_search', status: 'done' }],
    }, []);
    // Parts should be preserved in chronological order: text, tool, text
    // NOT rebuilt as a single text block + tools.
    const types = (result.parts ?? []).map((p) => p.type);
    expect(types).toEqual(['text', 'tool', 'text']);
    expect(result.parts?.[0]?.content).toBe(text1);
    expect(result.parts?.[2]?.content).toBe(text2);
  });

  it('preserves chronological order from DB rows when partsTextExceedsContent', () => {
    // Simulate the hard refresh case: DB rows are chronological, but the
    // combined text from rows exceeds the canonical content field.
    // The fix should preserve the DB rows' chronological ordering.
    const result = normalizeMessageForUi(
      {
        role: 'assistant',
        content: 'Final summary.', // shorter than combined text from rows
      },
      [
        { type: 'text-delta', content: 'Starting analysis. ' },
        { type: 'tool-call', tool_call_id: 't1', tool_name: 'shell_exec', tool_args: '{}' },
        { type: 'tool-result', tool_call_id: 't1', tool_result: 'ok', tool_success: 1 },
        { type: 'text-delta', content: 'Final summary.' },
      ],
    );
    const types = (result.parts ?? []).map((p) => p.type);
    expect(types).toEqual(['text', 'tool', 'text']);
  });

  it('merges mid-sentence thinking instead of splitting into a new Thought', () => {
    let parts = appendThinkingDeltaToParts([], 'The');
    parts = sealTrailingThinkingPart(parts); // incomplete → stays unsealed
    expect(parts[0]?.['sealed']).toBeFalsy();
    parts = appendThinkingDeltaToParts(parts, ' web app uses pnpm');
    expect(parts).toHaveLength(1);
    expect(parts[0]?.content).toBe('The web app uses pnpm');

    // Forced seal of a short fragment, then lowercase continuation must merge.
    parts = [
      { type: 'thinking' as const, id: 't1', content: 'The', sealed: true },
    ];
    parts = appendThinkingDeltaToParts(parts, ' web app uses pnpm workspaces');
    expect(parts).toHaveLength(1);
    expect(parts[0]?.content).toBe('The web app uses pnpm workspaces');
    expect(parts[0]?.['sealed']).toBe(false);
  });

  it('keeps short complete sentences unsealed until a paragraph-sized thought accumulates', () => {
    const short = 'Looks good.';
    let parts = appendThinkingDeltaToParts([], short);
    parts = sealTrailingThinkingPart(parts);
    expect(parts[0]?.['sealed']).toBeFalsy();

    const paragraph = `${'Analyzing the request carefully. '.repeat(8)}Done.`;
    parts = appendThinkingDeltaToParts([], paragraph);
    parts = sealTrailingThinkingPart(parts);
    expect(parts[0]?.['sealed']).toBe(true);
  });

  it('syncTextPartsWithCanonicalContent strips text when a valid response_document exists', () => {
    const parts = [
      { type: 'text' as const, id: 't1', content: 'Raw markdown draft' },
      {
        type: 'response_document' as const,
        id: 'rich-1',
        responseDocument: {
          version: 1 as const,
          title: 'Analysis',
          blocks: [{ type: 'text' as const, content: 'Clean rich answer' }],
        },
      },
    ];
    const synced = syncTextPartsWithCanonicalContent(parts, 'Raw markdown draft');
    expect(synced.some((p) => p.type === 'text')).toBe(false);
    expect(synced.filter((p) => p.type === 'response_document')).toHaveLength(1);
  });

  it('syncTextPartsWithCanonicalContent appends truncated stream suffix', () => {
    const parts = [
      { type: 'text' as const, id: 't1', content: 'Hello wor' },
    ];
    const synced = syncTextPartsWithCanonicalContent(parts, 'Hello world — done.');
    expect(synced).toHaveLength(1);
    expect(synced[0]?.content).toBe('Hello world — done.');
  });

  it('partsTextTruncatesContent detects coalesce truncation', () => {
    const parts = [{ type: 'text' as const, id: 't1', content: 'Short prefix' }];
    expect(partsTextTruncatesContent('Short prefix that continues to the full answer.', parts)).toBe(true);
    expect(shouldRebuildStoredParts('Short prefix that continues to the full answer.', parts)).toBe(true);
  });

  it('collapseOverlappingTextParts keeps the later overlapping draft', () => {
    const first = '## Overall assessment\n\nBoth reports show elevated glucose and lipids.';
    const second = `${first}\n\n## Detailed tables\n\n| Test | Value |\n| --- | --- |\n| Glucose | 335 |`;
    const collapsed = collapseOverlappingTextParts([
      { type: 'text' as const, id: 'a', content: first },
      { type: 'tool' as const, id: 'tool-1' },
      { type: 'text' as const, id: 'b', content: second },
    ]);
    expect(collapsed.filter((p) => p.type === 'text')).toHaveLength(1);
    expect(collapsed.find((p) => p.type === 'text')?.content).toBe(second);
    expect(collapsed.some((p) => p.type === 'tool')).toBe(true);
  });

  it('collapseOverlappingTextParts keeps one of two near-duplicate final answers', () => {
    const first = [
      'Sir, I could not find a verified currently active coupon code specifically for EasyTouch Wellness or Agatsa Smart Scale.',
      '',
      '| Source checked | Finding | Reliability |',
      '|---|---|---|',
      '| Official shop | No public coupon listed for those two products | Low |',
      '',
      'Try the official shop checkout and see whether a discount field appears.',
    ].join('\n');
    const second = [
      'Sir, I found no verified coupon code that can currently be confirmed for either EasyTouch Wellness or Agatsa Smart Scale.',
      '',
      '| Product | Official offer found | Coupon result |',
      '|---|---|---|',
      '| EasyTouch Wellness | None confirmed | No public code |',
      '',
      'Check the official shop at checkout for any automatic offer.',
    ].join('\n');
    const collapsed = collapseOverlappingTextParts([
      { type: 'text' as const, id: 'a', content: first },
      { type: 'tool' as const, id: 't' },
      { type: 'text' as const, id: 'b', content: second },
    ]);
    const texts = collapsed.filter((p) => p.type === 'text');
    expect(texts).toHaveLength(1);
    expect(texts[0]?.content).toBe(second);
  });

  it('collapseOverlappingTextParts keeps the longer draft when the later part is a prefix', () => {
    const full = '## Overall assessment\n\nBoth reports show elevated glucose and lipids.';
    const collapsed = collapseOverlappingTextParts([
      { type: 'text' as const, id: 'a', content: full },
      { type: 'text' as const, id: 'b', content: full.slice(0, 40) },
    ]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.content).toBe(full);
  });

  it('suppressOverlappingAssistantTexts drops an earlier text-only duplicate', () => {
    const report = '## Overall assessment\n\nBoth reports show elevated glucose and lipids.';
    const messages = suppressOverlappingAssistantTexts([
      { role: 'user', content: 'analyse these two medical lap reports' },
      { role: 'assistant', content: report, parts: [{ type: 'text', content: report }] },
      {
        role: 'assistant',
        content: '',
        parts: [
          { type: 'text', content: report.slice(0, 48) },
          { type: 'text', content: report },
        ],
      },
    ]);
    expect(messages.filter((m) => m.role === 'assistant')).toHaveLength(1);
    expect(textFromAssistantRecord(messages[1]!)).toBe(report);
  });

  it('suppressOverlappingAssistantTexts drops an earlier response_document of the same table', () => {
    const report = '| Test | Actual |\n|---|---|\n| Fasting blood glucose | 335 mg/dL |';
    const messages = suppressOverlappingAssistantTexts([
      {
        role: 'assistant',
        content: report,
        parts: [
          { type: 'text', content: report },
          { type: 'response_document', content: '' },
        ],
      },
      { role: 'assistant', content: report, parts: [{ type: 'text', content: report }] },
    ]);
    const assistants = messages.filter((m) => m.role === 'assistant');
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.parts?.some((p) => p.type === 'response_document')).toBe(false);
    expect(textFromAssistantRecord(assistants[0]!)).toBe(report);
  });

  it('suppressOverlappingAssistantTexts keeps earlier workflow parts', () => {
    const report = '## Overall assessment\n\nBoth reports show elevated glucose and lipids.';
    const messages = suppressOverlappingAssistantTexts([
      {
        role: 'assistant',
        content: report,
        parts: [
          { type: 'tool', content: '' },
          { type: 'text', content: report },
        ],
      },
      { role: 'assistant', content: report, parts: [{ type: 'text', content: report }] },
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.content).toBe('');
    expect(messages[0]?.parts?.every((p) => p.type === 'tool')).toBe(true);
    expect(textFromAssistantRecord(messages[1]!)).toBe(report);
  });

  it('isSettledPersistedTurn treats a matching persisted answer as done', () => {
    const report = '## Overall assessment\n\nBoth reports show elevated glucose and lipids.';
    expect(isSettledPersistedTurn({
      phase: 'running',
      partialContent: `${report}\n`,
      lastAssistantText: report,
      hasRunningTools: false,
    })).toBe(true);
    expect(isSettledPersistedTurn({
      phase: 'running',
      partialContent: report,
      lastAssistantText: report,
      hasRunningTools: true,
    })).toBe(false);
    expect(isSettledPersistedTurn({
      phase: 'idle',
      partialContent: report,
      lastAssistantText: report,
    })).toBe(false);
  });

  it('partsIndicateRunningTools reads nested tool status', () => {
    expect(partsIndicateRunningTools([{ type: 'tool', tool: { status: 'running' } }])).toBe(true);
    expect(partsIndicateRunningTools([{ type: 'tool', status: 'done' }])).toBe(false);
  });
});
