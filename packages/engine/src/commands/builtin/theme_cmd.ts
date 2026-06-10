import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '@agentx/shared';

export const themeCommand: CommandInterface = {
  name: 'theme',
  description: 'Change or persist UI theme',
  usage: '/theme [<name>|list|save|reload]',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    const sub = args[0];

    if (!sub || sub === 'list') {
      const themes = ['space', 'space_light', 'forest', 'ocean', 'sunset', 'monochrome', 'retro', 'colorblind'];
      const current = getCurrentThemeName();
      const lines = themes.map((t) => `  ${t}${t === current ? ' (active)' : ''}`);
      context.emit(`Available themes:\n${lines.join('\n')}\n\nUse /theme <name> to switch, /theme save to persist.`);
      return { success: true, action: 'none' };
    }

    if (sub === 'save') {
      const current = getCurrentThemeName();
      const configDir = getConfigDir();
      const themeFile = join(configDir, 'theme.json');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(themeFile, JSON.stringify({ theme: current }, null, 2), 'utf-8');
      context.emit(`Theme "${current}" saved to ${themeFile}.`);
      return { success: true, action: 'none' };
    }

    if (sub === 'reload') {
      const configDir = getConfigDir();
      const themeFile = join(configDir, 'theme.json');
      if (existsSync(themeFile)) {
        try {
          const data = JSON.parse(readFileSync(themeFile, 'utf-8')) as { theme: string };
          if (data.theme) {
            setCurrentThemeName(data.theme);
            context.emit(`Theme reloaded: "${data.theme}".`);
            return { success: true, action: 'theme_changed', payload: { theme: data.theme } };
          }
        } catch {
          // fallthrough
        }
      }
      context.emit('No saved theme found.');
      return { success: true, action: 'none' };
    }

    // /theme <name> — switch theme
    const themes = ['space', 'space_light', 'forest', 'ocean', 'sunset', 'monochrome', 'retro', 'colorblind'];
    if (themes.includes(sub)) {
      setCurrentThemeName(sub);
      context.emit(`Theme changed to "${sub}". Use /theme save to persist.`);
      return { success: true, action: 'theme_changed', payload: { theme: sub } };
    }

    context.emit(`Unknown theme "${sub}". Available: ${themes.join(', ')}`);
    return { success: false, action: 'none' };
  },
};

let _currentTheme = 'space';

function getCurrentThemeName(): string {
  return _currentTheme;
}

function setCurrentThemeName(name: string): void {
  _currentTheme = name;
}
