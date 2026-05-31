#!/usr/bin/env node
import { McpServer, type ToolDefinition } from '../base-server.js';

class HttpServer extends McpServer {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'http_get',
        description: 'Make an HTTP GET request',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to request' },
            headers: { type: 'string', description: 'JSON object of HTTP headers (optional)' },
            timeout: { type: 'string', description: 'Timeout in ms (default: 15000)' },
          },
          required: ['url'],
        },
      },
      {
        name: 'http_post',
        description: 'Make an HTTP POST request',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to request' },
            body: { type: 'string', description: 'Request body' },
            contentType: { type: 'string', description: 'Content-Type header (default: application/json)' },
            headers: { type: 'string', description: 'JSON object of additional HTTP headers (optional)' },
            timeout: { type: 'string', description: 'Timeout in ms (default: 15000)' },
          },
          required: ['url'],
        },
      },
      {
        name: 'http_put',
        description: 'Make an HTTP PUT request',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to request' },
            body: { type: 'string', description: 'Request body' },
            contentType: { type: 'string', description: 'Content-Type header (default: application/json)' },
            headers: { type: 'string', description: 'JSON object of additional HTTP headers (optional)' },
            timeout: { type: 'string', description: 'Timeout in ms (default: 15000)' },
          },
          required: ['url'],
        },
      },
    ];
  }

  private async request(method: string, url: string, args: Record<string, unknown>): Promise<unknown> {
    const headers: Record<string, string> = args['headers']
      ? JSON.parse(String(args['headers']))
      : {};
    headers['User-Agent'] = 'Agent-X-MCP/1.0';
    const timeout = parseInt(String(args['timeout'] ?? '15000'), 10);

    const opts: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(timeout),
    };

    if (method !== 'GET' && args['body']) {
      const contentType = String(args['contentType'] ?? 'application/json');
      headers['Content-Type'] = contentType;
      opts.body = String(args['body']);
    }

    const res = await fetch(url, opts);
    const contentType = res.headers.get('content-type') ?? '';
    let body: unknown;
    if (contentType.includes('application/json')) {
      body = await res.json();
    } else {
      body = await res.text();
    }

    return {
      url,
      method,
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.entries()),
      body,
    };
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'http_get':
        return this.request('GET', String(args['url']), args);
      case 'http_post':
        return this.request('POST', String(args['url']), args);
      case 'http_put':
        return this.request('PUT', String(args['url']), args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

new HttpServer().start();
