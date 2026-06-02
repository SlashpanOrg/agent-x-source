import type {
  ThemeTokens,
  ThemeMode,
  BuiltinTheme,
  ThemeEngineConfig,
} from '@agentx/shared';

const DEFAULT_THEMES: Record<string, BuiltinTheme> = {
  default: {
    name: 'Default',
    dark: {
      bg: '#0d1117',
      fg: '#e6edf3',
      accent: '#58a6ff',
      ok: '#3fb950',
      destructive: '#f85149',
      warn: '#d29922',
      muted: '#8b949e',
      border: '#30363d',
      surface: '#161b22',
      surfaceHover: '#1c2128',
      surfaceActive: '#1f242c',
      textPrimary: '#e6edf3',
      textSecondary: '#8b949e',
      textMuted: '#484f58',
      toolPending: '#8b949e',
      toolRunning: '#58a6ff',
      toolCompleted: '#3fb950',
      toolError: '#f85149',
      toolDenied: '#484f58',
      thinkingBg: 'rgba(88,166,255,0.04)',
      thinkingBorder: 'rgba(88,166,255,0.12)',
      thinkingText: '#8b949e',
      codeBg: '#161b22',
      codeBorder: '#30363d',
      codeText: '#e6edf3',
      diffAdded: '#3fb950',
      diffRemoved: '#f85149',
      diffAddedBg: 'rgba(63,185,80,0.15)',
      diffRemovedBg: 'rgba(248,81,73,0.15)',
      diffContextBg: 'transparent',
      diffLineNumber: '#484f58',
      markdownHeading: '#e6edf3',
      markdownLink: '#58a6ff',
      markdownCode: '#e6edf3',
      markdownBlockQuote: '#8b949e',
      syntaxKeyword: '#ff7b72',
      syntaxFunction: '#d2a8ff',
      syntaxString: '#a5d6ff',
      syntaxNumber: '#79c0ff',
      syntaxComment: '#8b949e',
      radiusSm: '4px',
      radiusMd: '8px',
      radiusLg: '12px',
      radiusFull: '9999px',
      easeOut: 'cubic-bezier(0.16,1,0.3,1)',
      easeSpring: 'cubic-bezier(0.34,1.56,0.64,1)',
      durationFast: '100ms',
      durationNormal: '180ms',
      durationSlow: '300ms',
      spinnerColor: '#58a6ff',
      thinkingOpacity: 0.6,
    },
    light: {
      bg: '#ffffff',
      fg: '#1f2328',
      accent: '#0969da',
      ok: '#1a7f37',
      destructive: '#cf222e',
      warn: '#9a6700',
      muted: '#656d76',
      border: '#d0d7de',
      surface: '#f6f8fa',
      surfaceHover: '#eaeef2',
      surfaceActive: '#e1e4e8',
      textPrimary: '#1f2328',
      textSecondary: '#656d76',
      textMuted: '#8c959f',
      toolPending: '#656d76',
      toolRunning: '#0969da',
      toolCompleted: '#1a7f37',
      toolError: '#cf222e',
      toolDenied: '#8c959f',
      thinkingBg: 'rgba(9,105,218,0.04)',
      thinkingBorder: 'rgba(9,105,218,0.12)',
      thinkingText: '#656d76',
      codeBg: '#f6f8fa',
      codeBorder: '#d0d7de',
      codeText: '#1f2328',
      diffAdded: '#1a7f37',
      diffRemoved: '#cf222e',
      diffAddedBg: 'rgba(26,127,55,0.15)',
      diffRemovedBg: 'rgba(207,34,46,0.15)',
      diffContextBg: 'transparent',
      diffLineNumber: '#8c959f',
      markdownHeading: '#1f2328',
      markdownLink: '#0969da',
      markdownCode: '#1f2328',
      markdownBlockQuote: '#656d76',
      syntaxKeyword: '#cf222e',
      syntaxFunction: '#8250df',
      syntaxString: '#0a3069',
      syntaxNumber: '#0550ae',
      syntaxComment: '#656d76',
      radiusSm: '4px',
      radiusMd: '8px',
      radiusLg: '12px',
      radiusFull: '9999px',
      easeOut: 'cubic-bezier(0.16,1,0.3,1)',
      easeSpring: 'cubic-bezier(0.34,1.56,0.64,1)',
      durationFast: '100ms',
      durationNormal: '180ms',
      durationSlow: '300ms',
      spinnerColor: '#0969da',
      thinkingOpacity: 0.5,
    },
  },
  dracula: {
    name: 'Dracula',
    dark: {
      bg: '#282a36',
      fg: '#f8f8f2',
      accent: '#bd93f9',
      ok: '#50fa7b',
      destructive: '#ff5555',
      warn: '#ffb86c',
      muted: '#6272a4',
      border: '#44475a',
      surface: '#21222c',
      surfaceHover: '#2d2f3f',
      surfaceActive: '#313345',
      textPrimary: '#f8f8f2',
      textSecondary: '#6272a4',
      textMuted: '#44475a',
      toolPending: '#6272a4',
      toolRunning: '#bd93f9',
      toolCompleted: '#50fa7b',
      toolError: '#ff5555',
      toolDenied: '#44475a',
      thinkingBg: 'rgba(189,147,249,0.04)',
      thinkingBorder: 'rgba(189,147,249,0.12)',
      thinkingText: '#6272a4',
      codeBg: '#21222c',
      codeBorder: '#44475a',
      codeText: '#f8f8f2',
      diffAdded: '#50fa7b',
      diffRemoved: '#ff5555',
      diffAddedBg: 'rgba(80,250,123,0.15)',
      diffRemovedBg: 'rgba(255,85,85,0.15)',
      diffContextBg: 'transparent',
      diffLineNumber: '#44475a',
      markdownHeading: '#f8f8f2',
      markdownLink: '#bd93f9',
      markdownCode: '#f8f8f2',
      markdownBlockQuote: '#6272a4',
      syntaxKeyword: '#ff79c6',
      syntaxFunction: '#50fa7b',
      syntaxString: '#f1fa8c',
      syntaxNumber: '#bd93f9',
      syntaxComment: '#6272a4',
      radiusSm: '4px',
      radiusMd: '8px',
      radiusLg: '12px',
      radiusFull: '9999px',
      easeOut: 'cubic-bezier(0.16,1,0.3,1)',
      easeSpring: 'cubic-bezier(0.34,1.56,0.64,1)',
      durationFast: '100ms',
      durationNormal: '180ms',
      durationSlow: '300ms',
      spinnerColor: '#bd93f9',
      thinkingOpacity: 0.6,
    },
    light: {
      bg: '#f8f8f2',
      fg: '#282a36',
      accent: '#bd93f9',
      ok: '#50fa7b',
      destructive: '#ff5555',
      warn: '#ffb86c',
      muted: '#6272a4',
      border: '#d8d8d4',
      surface: '#fcfcf8',
      surfaceHover: '#f0f0ec',
      surfaceActive: '#ebebe7',
      textPrimary: '#282a36',
      textSecondary: '#6272a4',
      textMuted: '#8b8e99',
      toolPending: '#6272a4',
      toolRunning: '#bd93f9',
      toolCompleted: '#50fa7b',
      toolError: '#ff5555',
      toolDenied: '#8b8e99',
      thinkingBg: 'rgba(189,147,249,0.04)',
      thinkingBorder: 'rgba(189,147,249,0.12)',
      thinkingText: '#6272a4',
      codeBg: '#f0f0ec',
      codeBorder: '#d8d8d4',
      codeText: '#282a36',
      diffAdded: '#50fa7b',
      diffRemoved: '#ff5555',
      diffAddedBg: 'rgba(80,250,123,0.15)',
      diffRemovedBg: 'rgba(255,85,85,0.15)',
      diffContextBg: 'transparent',
      diffLineNumber: '#8b8e99',
      markdownHeading: '#282a36',
      markdownLink: '#bd93f9',
      markdownCode: '#282a36',
      markdownBlockQuote: '#6272a4',
      syntaxKeyword: '#ff79c6',
      syntaxFunction: '#50fa7b',
      syntaxString: '#f1fa8c',
      syntaxNumber: '#bd93f9',
      syntaxComment: '#6272a4',
      radiusSm: '4px',
      radiusMd: '8px',
      radiusLg: '12px',
      radiusFull: '9999px',
      easeOut: 'cubic-bezier(0.16,1,0.3,1)',
      easeSpring: 'cubic-bezier(0.34,1.56,0.64,1)',
      durationFast: '100ms',
      durationNormal: '180ms',
      durationSlow: '300ms',
      spinnerColor: '#bd93f9',
      thinkingOpacity: 0.5,
    },
  },
};

export class ThemeEngine {
  private currentVariant: string;
  private currentMode: ThemeMode;
  private customTokens: Partial<ThemeTokens> | undefined;
  private tokens: ThemeTokens;

  constructor(config: ThemeEngineConfig = { mode: 'dark', variant: 'default' }) {
    this.currentMode = config.mode ?? 'dark';
    this.currentVariant = config.variant ?? 'default';
    this.customTokens = config.customTokens;
    this.tokens = this.computeTokens();
  }

  getTokens(): ThemeTokens {
    return this.tokens;
  }

  getMode(): ThemeMode {
    return this.currentMode;
  }

  setMode(mode: ThemeMode): void {
    this.currentMode = mode;
    this.tokens = this.computeTokens();
  }

  setVariant(variant: string): void {
    this.currentVariant = variant;
    this.tokens = this.computeTokens();
  }

  setCustomTokens(tokens: Partial<ThemeTokens>): void {
    this.customTokens = tokens;
    this.tokens = this.computeTokens();
  }

  toggle(): void {
    this.currentMode = this.currentMode === 'dark' ? 'light' : 'dark';
    this.tokens = this.computeTokens();
  }

  /** Generate CSS custom properties string */
  toCSS(): string {
    const cssVar = (key: string, value: string) => `  --ax-${key}: ${value};`;
    const lines: string[] = [':root[data-theme-mode="' + this.currentMode + '"] {'];

    for (const [key, value] of Object.entries(this.tokens)) {
      lines.push(cssVar(key, value));
    }

    lines.push('}');
    return lines.join('\n');
  }

  /** Return a Style-suitable object for CSS-in-JS frameworks */
  toStyleObject(): Record<string, string> {
    const obj: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.tokens)) {
      obj[`--ax-${key}`] = value;
    }
    return obj;
  }

  static listThemes(): string[] {
    return Object.keys(DEFAULT_THEMES);
  }

  static getTheme(name: string): BuiltinTheme | undefined {
    return DEFAULT_THEMES[name];
  }

  private computeTokens(): ThemeTokens {
    const builtin = DEFAULT_THEMES[this.currentVariant] ?? DEFAULT_THEMES['default']!;
    const base = this.currentMode === 'dark' ? builtin.dark : builtin.light;
    return this.customTokens ? { ...base, ...this.customTokens } : base;
  }
}
