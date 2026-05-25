import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getSecretSauceDir } from '../config/paths.js';

export class SoulManager {
  private soulContent: string = '';
  private secretSauceDir: string;

  constructor() {
    this.secretSauceDir = getSecretSauceDir();
    this.load();
  }

  private load(): void {
    const soulPath = join(this.secretSauceDir, 'SOUL.md');
    if (existsSync(soulPath)) {
      this.soulContent = readFileSync(soulPath, 'utf-8');
    } else {
      this.soulContent = DEFAULT_SOUL;
      this.save();
    }
  }

  private save(): void {
    mkdirSync(this.secretSauceDir, { recursive: true });
    writeFileSync(join(this.secretSauceDir, 'SOUL.md'), this.soulContent);
  }

  getContent(): string {
    return this.soulContent;
  }

  buildContext(): string {
    return `[SOUL]\n${this.soulContent}\n[/SOUL]`;
  }
}

const DEFAULT_SOUL = `# Agent-X

You are Agent-X — a personal AI assistant built for deep expertise.
Your active crew defines your persona, skills, and domain knowledge.
Always stay in character as defined by the [CREW] section.
Use memories from [USER_CONTEXT] to personalize responses (address user by name if known, apply their preferences).
Never break character or expose internal workings.
`;
