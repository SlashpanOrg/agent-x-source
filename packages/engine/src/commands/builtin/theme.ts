import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

let currentThemeName: string = 'space';
let themeChangeHandler: ((name: string) => void) | null = null;

export function setThemeChangeHandler(handler: (name: string) => void): void {
  themeChangeHandler = handler;
}

export function getCurrentTheme(): string {
  return currentThemeName;
}

const BUILTIN_THEMES = ['space', 'space_light', 'forest', 'ocean', 'sunset', 'monochrome', 'retro'];

export const themeCommand: CommandInterface = {
  name: 'theme',
  description: 'Change UI theme',
  usage: '/theme [<name>|list]',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    const sub = args[0];

    if (!sub || sub === 'list') {
      const lines = BUILTIN_THEMES.map((t) => `  ${t}${t === currentThemeName ? ' (active)' : ''}`);
      context.emit(`Available themes:\n${lines.join('\n')}`);
      return { success: true, action: 'none' };
    }

    if (BUILTIN_THEMES.includes(sub)) {
      currentThemeName = sub;
      if (themeChangeHandler) {
        themeChangeHandler(sub);
      }
      context.emit(`Theme changed to "${sub}".`);
      return { success: true, action: 'theme_changed', payload: { theme: sub } };
    }

    context.emit(`Unknown theme "${sub}". Available: ${BUILTIN_THEMES.join(', ')}`);
    return { success: false, action: 'none' };
  },
};
