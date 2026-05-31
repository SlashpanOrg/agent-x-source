import type { InputType } from '@agentx/shared';

export interface ParsedInput {
  type: InputType;
  raw: string;
  command?: string;
  args?: string[];
  chain?: ParsedInput[];
}

export class CommandParser {
  parse(input: string): ParsedInput {
    const trimmed = input.trim();

    // Check for command chaining with &&
    if (trimmed.includes('&&')) {
      const parts = trimmed.split(/\s*&&\s*/);
      const parsed = parts.map((part) => this.parseSingle(part));
      return {
        type: 'command',
        raw: trimmed,
        command: parsed[0]?.command,
        args: parsed[0]?.args,
        chain: parsed,
      };
    }

    return this.parseSingle(trimmed);
  }

  private parseSingle(input: string): ParsedInput {
    if (input.startsWith('/')) {
      const parts = input.slice(1).split(/\s+/);
      const command = parts[0] ?? '';
      const args = parts.slice(1);
      return {
        type: 'command',
        raw: input,
        command,
        args,
      };
    }

    return {
      type: 'conversation',
      raw: input,
    };
  }

  isCommand(input: string): boolean {
    return input.trim().startsWith('/') || input.trim().includes('&&');
  }

  extractPrefix(input: string): string {
    if (!this.isCommand(input)) return '';
    const parts = input.trim().slice(1).split(/\s+/);
    return parts[0] ?? '';
  }
}
