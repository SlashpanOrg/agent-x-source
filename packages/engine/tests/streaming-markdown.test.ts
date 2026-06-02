import { describe, it, expect } from 'vitest';
import { StreamingMarkdownRenderer } from '../src/communication/visuals/StreamingMarkdownRenderer.js';

describe('StreamingMarkdownRenderer', () => {
  it('splits text at double-newline boundary', () => {
    const renderer = new StreamingMarkdownRenderer();
    const result = renderer.render('Hello\n\nWorld');

    expect(result.stablePrefix).toContain('Hello');
    expect(result.unstableSuffix).toBe('World');
  });

  it('grows stable prefix monotonically', () => {
    const renderer = new StreamingMarkdownRenderer();
    renderer.render('Line 1\n\nLine 2');
    const result = renderer.render('Line 1\n\nLine 2 continues');

    expect(result.stablePrefix).toBe('Line 1\n\n');
    expect(result.unstableSuffix).toBe('Line 2 continues');
  });

  it('does not split inside fenced code blocks', () => {
    const renderer = new StreamingMarkdownRenderer();
    // Text with a code block followed by content outside
    const result = renderer.render('Before\n\n```\ncode\n```\n\nAfter');

    // The stable prefix should include everything before the final 'After'
    expect(result.stableHtml).toContain('Before');
    expect(result.stableHtml).toContain('```');
    expect(result.unstableText).toBe('After');
  });

  it('resets correctly', () => {
    const renderer = new StreamingMarkdownRenderer();
    renderer.render('Hello\n\nWorld');
    renderer.reset();
    const result = renderer.render('New text');

    expect(result.stablePrefix).toBe('');
    expect(result.unstableSuffix).toBe('New text');
  });

  it('handles empty text', () => {
    const renderer = new StreamingMarkdownRenderer();
    const result = renderer.render('');

    expect(result.stablePrefix).toBe('');
    expect(result.unstableSuffix).toBe('');
    expect(result.boundaryPosition).toBe(0);
  });
});
