#!/usr/bin/env node
import { randomUUID, randomBytes, randomInt } from 'node:crypto';
import { McpServer, type ToolDefinition } from '../base-server.js';

class UuidServer extends McpServer {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'generate_uuid',
        description: 'Generate a UUID v4 string',
        inputSchema: {
          type: 'object',
          properties: {
            count: { type: 'string', description: 'Number of UUIDs to generate (default: 1)' },
          },
        },
      },
      {
        name: 'generate_nanoid',
        description: 'Generate a short unique ID (like nanoid)',
        inputSchema: {
          type: 'object',
          properties: {
            length: { type: 'string', description: 'Length of the ID (default: 21)' },
            count: { type: 'string', description: 'Number of IDs to generate (default: 1)' },
          },
        },
      },
      {
        name: 'validate_uuid',
        description: 'Check if a string is a valid UUID',
        inputSchema: {
          type: 'object',
          properties: { value: { type: 'string', description: 'String to validate' } },
          required: ['value'],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'generate_uuid': {
        const count = parseInt(String(args['count'] ?? '1'), 10);
        const uuids = Array.from({ length: count }, () => randomUUID());
        return { uuids, count };
      }
      case 'generate_nanoid': {
        const length = parseInt(String(args['length'] ?? '21'), 10);
        const count = parseInt(String(args['count'] ?? '1'), 10);
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
        const ids = Array.from({ length: count }, () => {
          const bytes = randomBytes(length);
          return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
        });
        return { ids, count, length, alphabet: 'A-Za-z0-9_-' };
      }
      case 'validate_uuid': {
        const value = String(args['value']);
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        return { valid: uuidRegex.test(value), value };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

new UuidServer().start();
