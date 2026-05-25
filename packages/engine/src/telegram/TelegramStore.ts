import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '../config/paths.js';

interface TelegramStoredConfig {
  botToken: string;
  allowedUserIds?: number[];
}

const CONFIG_FILE = 'telegram.json';

/**
 * Persists Telegram bot configuration to disk.
 * Stored in ~/.config/agentx/telegram.json
 */
export class TelegramStore {
  private configPath: string;

  constructor() {
    const dir = getConfigDir();
    mkdirSync(dir, { recursive: true });
    this.configPath = join(dir, CONFIG_FILE);
  }

  save(config: TelegramStoredConfig): void {
    writeFileSync(this.configPath, JSON.stringify(config, null, 2));
  }

  load(): TelegramStoredConfig | null {
    if (!existsSync(this.configPath)) return null;
    try {
      return JSON.parse(readFileSync(this.configPath, 'utf-8')) as TelegramStoredConfig;
    } catch {
      return null;
    }
  }

  isConfigured(): boolean {
    return this.load() !== null;
  }

  clear(): void {
    if (existsSync(this.configPath)) {
      writeFileSync(this.configPath, '{}');
    }
  }
}
