#!/usr/bin/env node
import { McpServer, type ToolDefinition } from '../base-server.js';

class EncodingServer extends McpServer {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'base64_encode',
        description: 'Encode text to Base64',
        inputSchema: {
          type: 'object',
          properties: { input: { type: 'string', description: 'Text to encode' } },
          required: ['input'],
        },
      },
      {
        name: 'base64_decode',
        description: 'Decode Base64 to text',
        inputSchema: {
          type: 'object',
          properties: { input: { type: 'string', description: 'Base64 string to decode' } },
          required: ['input'],
        },
      },
      {
        name: 'hex_encode',
        description: 'Encode text to hexadecimal',
        inputSchema: {
          type: 'object',
          properties: { input: { type: 'string', description: 'Text to encode' } },
          required: ['input'],
        },
      },
      {
        name: 'hex_decode',
        description: 'Decode hexadecimal to text',
        inputSchema: {
          type: 'object',
          properties: { input: { type: 'string', description: 'Hex string to decode' } },
          required: ['input'],
        },
      },
      {
        name: 'url_encode',
        description: 'URL-encode a string',
        inputSchema: {
          type: 'object',
          properties: { input: { type: 'string', description: 'String to URL-encode' } },
          required: ['input'],
        },
      },
      {
        name: 'url_decode',
        description: 'URL-decode a string',
        inputSchema: {
          type: 'object',
          properties: { input: { type: 'string', description: 'URL-encoded string to decode' } },
          required: ['input'],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'base64_encode': {
        const input = String(args['input']);
        const encoded = Buffer.from(input, 'utf-8').toString('base64');
        return { input, encoded, encoding: 'base64' };
      }
      case 'base64_decode': {
        const input = String(args['input']);
        const decoded = Buffer.from(input, 'base64').toString('utf-8');
        return { input, decoded, encoding: 'utf-8' };
      }
      case 'hex_encode': {
        const input = String(args['input']);
        const encoded = Buffer.from(input, 'utf-8').toString('hex');
        return { input, encoded, encoding: 'hex' };
      }
      case 'hex_decode': {
        const input = String(args['input']);
        const decoded = Buffer.from(input, 'hex').toString('utf-8');
        return { input, decoded, encoding: 'utf-8' };
      }
      case 'url_encode': {
        const input = String(args['input']);
        const encoded = encodeURIComponent(input);
        return { input, encoded };
      }
      case 'url_decode': {
        const input = String(args['input']);
        const decoded = decodeURIComponent(input);
        return { input, decoded };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

new EncodingServer().start();
