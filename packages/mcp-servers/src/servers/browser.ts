#!/usr/bin/env node
import { McpServer, type ToolDefinition } from '../base-server.js';

class BrowserServer extends McpServer {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'fetch_page',
        description: 'Fetch and extract text content from a URL',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to fetch' },
            selector: { type: 'string', description: 'CSS selector to extract specific content (optional)' },
            maxLength: { type: 'string', description: 'Maximum characters to return (default: 10000)' },
          },
          required: ['url'],
        },
      },
      {
        name: 'fetch_json',
        description: 'Fetch JSON data from a URL',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to fetch' },
            headers: { type: 'string', description: 'JSON object of HTTP headers (optional)' },
          },
          required: ['url'],
        },
      },
      {
        name: 'screenshot',
        description: 'Take a screenshot of a webpage (requires puppeteer/playwright)',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to screenshot' },
            width: { type: 'string', description: 'Viewport width (default: 1280)' },
            height: { type: 'string', description: 'Viewport height (default: 720)' },
            fullPage: { type: 'string', description: 'Capture full page (default: false)' },
          },
          required: ['url'],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'fetch_page': {
        const url = String(args['url']);
        const maxLength = parseInt(String(args['maxLength'] ?? '10000'), 10);
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Agent-X-MCP/1.0' },
          signal: AbortSignal.timeout(15000),
        });
        const html = await res.text();

        // Basic HTML-to-text extraction
        const text = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&[a-z]+;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        const truncated = text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
        return { url, content: truncated, fullLength: text.length, truncated: text.length > maxLength };
      }
      case 'fetch_json': {
        const url = String(args['url']);
        const headers: Record<string, string> = args['headers']
          ? JSON.parse(String(args['headers']))
          : { 'User-Agent': 'Agent-X-MCP/1.0' };
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
        const data = await res.json();
        return { url, status: res.status, data };
      }
      case 'screenshot': {
        const url = String(args['url']);
        const width = parseInt(String(args['width'] ?? '1280'), 10);
        const height = parseInt(String(args['height'] ?? '720'), 10);
        const fullPage = args['fullPage'] === 'true';

        try {
          // @ts-expect-error — puppeteer is optional, guarded by try/catch
          const { launch } = await import('puppeteer');
          const browser = await launch({ headless: true });
          try {
            const page = await browser.newPage();
            await page.setViewport({ width, height });
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            const screenshot = await page.screenshot({ fullPage, encoding: 'base64' });
            return { url, screenshot: `data:image/png;base64,${screenshot}`, format: 'base64_png' };
          } finally {
            await browser.close();
          }
        } catch {
          return { url, error: 'Puppeteer not available. Install puppeteer for screenshot support.' };
        }
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

new BrowserServer().start();
