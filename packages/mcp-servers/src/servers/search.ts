#!/usr/bin/env node
import { McpServer, type ToolDefinition } from '../base-server.js';

class SearchServer extends McpServer {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'web_search',
        description: 'Search the web for information',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            count: { type: 'string', description: 'Number of results (default: 5)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'search_news',
        description: 'Search for recent news articles',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            count: { type: 'string', description: 'Number of results (default: 5)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'search_docs',
        description: 'Search documentation sites (MDN, Python docs, etc.)',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            site: { type: 'string', description: 'Site to search (mdn, python, npm, react)' },
          },
          required: ['query', 'site'],
        },
      },
    ];
  }

  private searchUrls: Record<string, string> = {
    mdn: 'developer.mozilla.org',
    python: 'docs.python.org',
    npm: 'docs.npmjs.com',
    react: 'react.dev',
  };

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'web_search': {
        const query = String(args['query']);
        const count = parseInt(String(args['count'] ?? '5'), 10);
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Agent-X-MCP/1.0' },
          signal: AbortSignal.timeout(10000),
        });
        const html = await res.text();

        // Extract search result links
        const results: Array<{ title: string; url: string; snippet: string }> = [];
        const linkRegex = /<a[^>]+class="result__a"[^>]*>(.*?)<\/a>.*?<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/gs;
        let match;
        let idx = 0;
        while ((match = linkRegex.exec(html)) !== null && idx < count) {
          const title = match[1]!.replace(/<[^>]+>/g, '').trim();
          const snippet = match[2]!.replace(/<[^>]+>/g, '').trim();
          const hrefMatch = html.slice(match.index, match.index + 500).match(/href="([^"]+)"/);
          const resultUrl = hrefMatch ? hrefMatch[1]! : '';
          if (title && resultUrl) {
            results.push({ title, url: resultUrl, snippet });
            idx++;
          }
        }

        return { query, results, count: results.length };
      }
      case 'search_news': {
        const query = String(args['query']);
        const count = parseInt(String(args['count'] ?? '5'), 10);
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&iar=news`;
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Agent-X-MCP/1.0' },
          signal: AbortSignal.timeout(10000),
        });
        const html = await res.text();

        const results: Array<{ title: string; url: string; snippet: string }> = [];
        const linkRegex = /<a[^>]+class="result__a"[^>]*>(.*?)<\/a>.*?<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/gs;
        let match;
        let idx = 0;
        while ((match = linkRegex.exec(html)) !== null && idx < count) {
          const title = match[1]!.replace(/<[^>]+>/g, '').trim();
          const snippet = match[2]!.replace(/<[^>]+>/g, '').trim();
          const hrefMatch = html.slice(match.index, match.index + 500).match(/href="([^"]+)"/);
          const resultUrl = hrefMatch ? hrefMatch[1]! : '';
          if (title && resultUrl) {
            results.push({ title, url: resultUrl, snippet });
            idx++;
          }
        }

        return { query, results, count: results.length };
      }
      case 'search_docs': {
        const query = String(args['query']);
        const site = String(args['site']);
        const siteUrl = this.searchUrls[site];
        if (!siteUrl) throw new Error(`Unknown documentation site: ${site}. Supported: ${Object.keys(this.searchUrls).join(', ')}`);
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}+site:${siteUrl}`;
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Agent-X-MCP/1.0' },
          signal: AbortSignal.timeout(10000),
        });
        const html = await res.text();

        const results: Array<{ title: string; url: string; snippet: string }> = [];
        const linkRegex = /<a[^>]+class="result__a"[^>]*>(.*?)<\/a>.*?<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/gs;
        let match;
        while ((match = linkRegex.exec(html)) !== null) {
          const title = match[1]!.replace(/<[^>]+>/g, '').trim();
          const snippet = match[2]!.replace(/<[^>]+>/g, '').trim();
          const hrefMatch = html.slice(match.index, match.index + 500).match(/href="([^"]+)"/);
          const resultUrl = hrefMatch ? hrefMatch[1]! : '';
          if (title && resultUrl) {
            results.push({ title, url: resultUrl, snippet });
          }
        }

        return { query, site, results, count: results.length };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

new SearchServer().start();
