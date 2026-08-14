import { describe, it, expect } from 'vitest';
import { createChatMarkdownSection, createVisualStageSection } from '../src/prompt/assembly/sections.js';

describe('createChatMarkdownSection', () => {
  it('exports static chat markdown instructions', async () => {
    const section = createChatMarkdownSection();
    const loaded = await section.load();
    expect(loaded).toContain('[CHAT_MARKDOWN]');
    expect(loaded).toContain('GitHub-Flavored Markdown');
    expect(loaded).toContain('TOOL FILE CONTENT');
    expect(loaded).toContain('file_write');
    expect(loaded).toContain('Do NOT wrap source code');
    expect(loaded).toContain('present_visual');
    expect(section.render(loaded)).toBe(loaded);
  });

  it('exports visual stage instructions for voice and chat', async () => {
    const section = createVisualStageSection();
    const loaded = await section.load();
    expect(loaded).toContain('[VISUAL_STAGE]');
    expect(loaded).toContain('present_visual');
    expect(loaded).toContain('visual stage modal');
    expect(loaded).toContain('Web photos/videos');
    expect(loaded).toContain('default browser');
  });

  it('does not diff between reconciliations', () => {
    const section = createChatMarkdownSection();
    expect(section.diff('a', 'b')).toBeNull();
  });
});
