#!/usr/bin/env node
import { McpServer, type ToolDefinition } from '../base-server.js';

class JsonServer extends McpServer {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'json_parse',
        description: 'Parse a JSON string and return a formatted view',
        inputSchema: {
          type: 'object',
          properties: { input: { type: 'string', description: 'JSON string to parse' } },
          required: ['input'],
        },
      },
      {
        name: 'json_stringify',
        description: 'Convert a value to a JSON string',
        inputSchema: {
          type: 'object',
          properties: {
            value: { type: 'string', description: 'JavaScript value as JSON' },
            pretty: { type: 'string', description: 'Pretty-print if true (default: true)' },
          },
          required: ['value'],
        },
      },
      {
        name: 'json_query',
        description: 'Query a JSON value using JMESPath or dot notation',
        inputSchema: {
          type: 'object',
          properties: {
            json: { type: 'string', description: 'JSON string' },
            path: { type: 'string', description: 'Dot-notation path (e.g., data.items[0].name)' },
          },
          required: ['json', 'path'],
        },
      },
      {
        name: 'json_validate',
        description: 'Validate whether a string is valid JSON',
        inputSchema: {
          type: 'object',
          properties: { input: { type: 'string', description: 'String to validate' } },
          required: ['input'],
        },
      },
    ];
  }

  private resolvePath(obj: unknown, path: string): unknown {
    return path.split(/\.|\[|\]\.?/).filter(Boolean).reduce((acc: unknown, key: string) => {
      if (acc == null) return undefined;
      if (Array.isArray(acc) && /^\d+$/.test(key)) return acc[parseInt(key, 10)];
      if (typeof acc === 'object' && acc !== null) return (acc as Record<string, unknown>)[key];
      return undefined;
    }, obj);
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'json_parse': {
        const input = String(args['input']);
        const parsed = JSON.parse(input);
        return { valid: true, type: Array.isArray(parsed) ? 'array' : typeof parsed, value: parsed };
      }
      case 'json_stringify': {
        const raw = String(args['value']);
        const pretty = args['pretty'] !== 'false';
        const parsed = JSON.parse(raw);
        const output = pretty ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed);
        return { output, length: output.length };
      }
      case 'json_query': {
        const json = String(args['json']);
        const path = String(args['path']);
        const parsed = JSON.parse(json);
        const result = this.resolvePath(parsed, path);
        return { path, found: result !== undefined, result };
      }
      case 'json_validate': {
        const input = String(args['input']);
        try {
          JSON.parse(input);
          return { valid: true };
        } catch (e) {
          return { valid: false, error: (e as Error).message };
        }
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

new JsonServer().start();
