import { describe, it, expect } from 'vitest';
import { ThemeEngine } from '../src/communication/visuals/ThemeEngine.js';

describe('ThemeEngine', () => {
  it('defaults to dark mode', () => {
    const engine = new ThemeEngine();
    expect(engine.getMode()).toBe('dark');
  });

  it('toggles between dark and light', () => {
    const engine = new ThemeEngine();
    engine.toggle();
    expect(engine.getMode()).toBe('light');
    engine.toggle();
    expect(engine.getMode()).toBe('dark');
  });

  it('switches theme variants', () => {
    const engine = new ThemeEngine({ variant: 'dracula' });
    const tokens = engine.getTokens();
    expect(tokens.accent).toBe('#bd93f9');
  });

  it('falls back to default for unknown variants', () => {
    const engine = new ThemeEngine({ variant: 'nonexistent' });
    const tokens = engine.getTokens();
    expect(tokens.accent).toBe('#58a6ff');
  });

  it('generates CSS custom properties', () => {
    const engine = new ThemeEngine();
    const css = engine.toCSS();

    expect(css).toContain('data-theme-mode="dark"');
    expect(css).toContain('--ax-bg:');
    expect(css).toContain('--ax-accent:');
  });

  it('generates style object for CSS-in-JS', () => {
    const engine = new ThemeEngine();
    const obj = engine.toStyleObject();

    expect(obj['--ax-bg']).toBe('#0d1117');
    expect(obj['--ax-accent']).toBe('#58a6ff');
  });

  it('lists built-in themes', () => {
    const themes = ThemeEngine.listThemes();
    expect(themes).toContain('default');
    expect(themes).toContain('dracula');
  });

  it('applies custom token overrides', () => {
    const engine = new ThemeEngine({
      customTokens: { bg: '#000000', accent: '#ff0000' },
    });
    const tokens = engine.getTokens();

    expect(tokens.bg).toBe('#000000');
    expect(tokens.accent).toBe('#ff0000');
    expect(tokens.ok).toBe('#3fb950'); // unchanged from default
  });
});
