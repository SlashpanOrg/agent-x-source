#!/usr/bin/env node
import { createHash, createHmac, randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import { McpServer, type ToolDefinition } from '../base-server.js';

class CryptoServe extends McpServer {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'hash',
        description: 'Compute a hash of input text',
        inputSchema: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'Text to hash' },
            algorithm: { type: 'string', description: 'Hash algorithm: md5, sha1, sha256, sha512 (default: sha256)' },
          },
          required: ['input'],
        },
      },
      {
        name: 'hmac',
        description: 'Compute an HMAC signature',
        inputSchema: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'Message to sign' },
            secret: { type: 'string', description: 'Secret key' },
            algorithm: { type: 'string', description: 'Hash algorithm (default: sha256)' },
          },
          required: ['input', 'secret'],
        },
      },
      {
        name: 'generate_token',
        description: 'Generate a cryptographically secure random token',
        inputSchema: {
          type: 'object',
          properties: {
            bytes: { type: 'string', description: 'Number of random bytes (default: 32)' },
            encoding: { type: 'string', description: 'hex, base64, or base64url (default: hex)' },
          },
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'hash': {
        const input = String(args['input']);
        const algorithm = String(args['algorithm'] ?? 'sha256');
        const hash = createHash(algorithm).update(input).digest('hex');
        return { algorithm, input, hash };
      }
      case 'hmac': {
        const input = String(args['input']);
        const secret = String(args['secret']);
        const algorithm = String(args['algorithm'] ?? 'sha256');
        const hmac = createHmac(algorithm, secret).update(input).digest('hex');
        return { algorithm, signature: hmac };
      }
      case 'generate_token': {
        const bytes = parseInt(String(args['bytes'] ?? '32'), 10);
        const encoding = String(args['encoding'] ?? 'hex') as BufferEncoding;
        const token = randomBytes(bytes).toString(encoding);
        return { token, bytes, encoding };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

new CryptoServe().start();
