import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface DefaultServerConfig {
  command: string;
  args: string[];
  enabled: boolean;
  transport: 'stdio';
  permissionLevel: 'low' | 'medium' | 'high' | 'critical';
}

export function getDefaultServerConfigs(): Record<string, DefaultServerConfig> {
  const mcpDir = join(__dirname, '..');
  const distDir = join(mcpDir, 'dist', 'servers');

  return {
    filesystem: {
      command: 'node',
      args: [join(distDir, 'filesystem.js')],
      enabled: true,
      transport: 'stdio',
      permissionLevel: 'medium',
    },
    database: {
      command: 'node',
      args: [join(distDir, 'database.js')],
      enabled: true,
      transport: 'stdio',
      permissionLevel: 'medium',
    },
    browser: {
      command: 'node',
      args: [join(distDir, 'browser.js')],
      enabled: true,
      transport: 'stdio',
      permissionLevel: 'medium',
    },
    search: {
      command: 'node',
      args: [join(distDir, 'search.js')],
      enabled: true,
      transport: 'stdio',
      permissionLevel: 'low',
    },
    shell: {
      command: 'node',
      args: [join(distDir, 'shell.js')],
      enabled: false,
      transport: 'stdio',
      permissionLevel: 'critical',
    },
    git: {
      command: 'node',
      args: [join(distDir, 'git.js')],
      enabled: true,
      transport: 'stdio',
      permissionLevel: 'medium',
    },
    json: {
      command: 'node',
      args: [join(distDir, 'json.js')],
      enabled: true,
      transport: 'stdio',
      permissionLevel: 'low',
    },
    math: {
      command: 'node',
      args: [join(distDir, 'math.js')],
      enabled: true,
      transport: 'stdio',
      permissionLevel: 'low',
    },
    uuid: {
      command: 'node',
      args: [join(distDir, 'uuid.js')],
      enabled: true,
      transport: 'stdio',
      permissionLevel: 'low',
    },
    crypto: {
      command: 'node',
      args: [join(distDir, 'crypto.js')],
      enabled: true,
      transport: 'stdio',
      permissionLevel: 'low',
    },
    datetime: {
      command: 'node',
      args: [join(distDir, 'datetime.js')],
      enabled: true,
      transport: 'stdio',
      permissionLevel: 'low',
    },
    encoding: {
      command: 'node',
      args: [join(distDir, 'encoding.js')],
      enabled: true,
      transport: 'stdio',
      permissionLevel: 'low',
    },
    http: {
      command: 'node',
      args: [join(distDir, 'http.js')],
      enabled: true,
      transport: 'stdio',
      permissionLevel: 'medium',
    },
    'fs-diff': {
      command: 'node',
      args: [join(distDir, 'fsdiff.js')],
      enabled: true,
      transport: 'stdio',
      permissionLevel: 'medium',
    },
    template: {
      command: 'node',
      args: [join(distDir, 'template.js')],
      enabled: true,
      transport: 'stdio',
      permissionLevel: 'low',
    },
  };
}

export function seedMcpConfigIfMissing(mcpConfigPath: string): boolean {
  if (existsSync(mcpConfigPath)) {
    const existing = JSON.parse(readFileSync(mcpConfigPath, 'utf-8'));
    const defaults = getDefaultServerConfigs();
    let changed = false;
    for (const [name, config] of Object.entries(defaults)) {
      if (!(name in existing)) {
        existing[name] = config;
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(mcpConfigPath, JSON.stringify(existing, null, 2));
      return true;
    }
    return false;
  }

  // File doesn't exist — create it with defaults
  const defaults = getDefaultServerConfigs();
  const dir = dirname(mcpConfigPath);
  if (!existsSync(dir)) {
    const { mkdirSync } = require('node:fs');
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(mcpConfigPath, JSON.stringify(defaults, null, 2));
  return true;
}
