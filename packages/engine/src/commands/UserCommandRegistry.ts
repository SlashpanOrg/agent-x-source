import type { CommandInterface, CommandContext, CommandResult } from './CommandInterface.js';
import { CommandRegistry } from './CommandRegistry.js';

export interface UserCommandConfig {
  name: string;
  description: string;
  template: string;
  variables?: string[];
}

export class UserCommandRegistry {
  private registry: CommandRegistry;
  private commands: Map<string, UserCommandConfig> = new Map();

  constructor(registry: CommandRegistry) {
    this.registry = registry;
  }

  loadFromConfig(configs: UserCommandConfig[]): void {
    for (const cmd of configs) {
      this.register(cmd);
    }
  }

  register(config: UserCommandConfig): void {
    this.commands.set(config.name, config);
    const command: CommandInterface = {
      name: config.name,
      description: config.description,
      usage: `/${config.name} ${config.variables?.map((v) => `<${v}>`).join(' ') ?? ''}`,
      execute: async (args: string[], context: CommandContext): Promise<CommandResult> => {
        let output = config.template;
        if (config.variables) {
          for (let i = 0; i < config.variables.length; i++) {
            const val = args[i] ?? '';
            output = output.replaceAll(`{{${config.variables[i]}}}`, val);
            output = output.replaceAll(`$${i + 1}`, val);
          }
        }
        output = output.replace(/\{\{\w+\}\}/g, '');
        const remaining = args.slice(config.variables?.length ?? 0).join(' ');
        if (remaining) {
          output = output.replace(/\{\{args\}\}/g, remaining);
          if (!output.includes('{{args}}')) {
            output += ' ' + remaining;
          }
        } else {
          output = output.replace(/\{\{args\}\}/g, '');
        }
        context.emit(output);
        return { success: true, action: 'none', output };
      },
    };
    this.registry.register(command);
  }

  unregister(name: string): void {
    const cmd = this.commands.get(name);
    if (cmd) {
      this.commands.delete(name);
      try { this.registry.unregister(name); } catch { /* ignore */ }
    }
  }

  getConfig(name: string): UserCommandConfig | undefined {
    return this.commands.get(name);
  }

  updateConfig(name: string, updates: Partial<UserCommandConfig>): boolean {
    const existing = this.commands.get(name);
    if (!existing) return false;
    const updated = { ...existing, ...updates };
    if (updates.name && updates.name !== name) {
      this.commands.delete(name);
    }
    this.register(updated);
    return true;
  }

  listCommands(): UserCommandConfig[] {
    return Array.from(this.commands.values());
  }
}
