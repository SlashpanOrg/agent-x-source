import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';

export async function httpGet(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  const headers = (args['headers'] as Record<string, string>) ?? {};

  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    const contentType = response.headers.get('content-type') ?? '';
    let body: string;

    if (contentType.includes('json')) {
      body = JSON.stringify(await response.json(), null, 2);
    } else {
      body = await response.text();
      if (body.length > 50000) body = body.slice(0, 50000) + '\n...(truncated)';
    }

    return {
      success: response.ok,
      output: body,
      metadata: { status: response.status, contentType },
    };
  } catch (error) {
    return { success: false, output: `Request failed: ${(error as Error).message}`, error: 'HTTP_ERROR' };
  }
}

export async function httpPost(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  const body = args['body'] as string | Record<string, unknown>;
  const headers = (args['headers'] as Record<string, string>) ?? {};

  const isJson = typeof body === 'object';
  if (isJson && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: isJson ? JSON.stringify(body) : body as string,
      signal: AbortSignal.timeout(30000),
    });

    const text = await response.text();
    return {
      success: response.ok,
      output: text.length > 50000 ? text.slice(0, 50000) + '\n...(truncated)' : text,
      metadata: { status: response.status },
    };
  } catch (error) {
    return { success: false, output: `Request failed: ${(error as Error).message}`, error: 'HTTP_ERROR' };
  }
}

export async function httpRequest(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  const method = ((args['method'] as string) ?? 'GET').toUpperCase();
  const headers = (args['headers'] as Record<string, string>) ?? {};
  const body = args['body'] as string | undefined;

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
      signal: AbortSignal.timeout(30000),
    });

    const text = await response.text();
    const headerEntries = [...response.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n');

    return {
      success: response.ok,
      output: `HTTP/${response.status} ${response.statusText}\n${headerEntries}\n\n${text.slice(0, 30000)}`,
      metadata: { status: response.status, method },
    };
  } catch (error) {
    return { success: false, output: (error as Error).message, error: 'HTTP_ERROR' };
  }
}

export async function webScrape(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  const selector = args['selector'] as string | undefined;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'AgentX/0.1' },
      signal: AbortSignal.timeout(15000),
    });

    const html = await response.text();

    // Basic text extraction — strip HTML tags
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (selector) {
      text = `(CSS selector "${selector}" requires browser — returning full text)\n${text}`;
    }

    if (text.length > 30000) text = text.slice(0, 30000) + '\n...(truncated)';

    return { success: true, output: text, metadata: { url, length: text.length } };
  } catch (error) {
    return { success: false, output: (error as Error).message, error: 'SCRAPE_ERROR' };
  }
}

export async function webSearch(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
  const query = args['query'] as string;
  // Use DuckDuckGo HTML for basic search (no API key needed)
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'AgentX/0.1' },
      signal: AbortSignal.timeout(10000),
    });

    const html = await response.text();
    // Extract result snippets
    const results: string[] = [];
    const snippetRegex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = snippetRegex.exec(html)) !== null && results.length < 5) {
      const text = match[1]!.replace(/<[^>]+>/g, '').trim();
      if (text) results.push(text);
    }

    return {
      success: true,
      output: results.length > 0 ? results.join('\n\n') : 'No results found',
      metadata: { query, resultCount: results.length },
    };
  } catch (error) {
    return { success: false, output: (error as Error).message, error: 'SEARCH_ERROR' };
  }
}

export async function httpDownload(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  const output = args['output'] as string;

  if (!url || !output) {
    return { success: false, output: 'url and output are required', error: 'MISSING_INPUT' };
  }

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) {
      return { success: false, output: `Download failed: HTTP ${response.status}`, error: 'HTTP_ERROR' };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const filePath = resolve(context.scopePath, output);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, buffer);
    return { success: true, output: `Downloaded ${url} to ${output} (${buffer.length} bytes)`, metadata: { size: buffer.length } };
  } catch (error) {
    return { success: false, output: `Download failed: ${(error as Error).message}`, error: 'DOWNLOAD_ERROR' };
  }
}

export async function webBrowse(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  if (!url) return { success: false, output: 'url is required', error: 'MISSING_INPUT' };

  // Check if Playwright is available
  try {
    execSync('npx playwright --version 2>/dev/null', { timeout: 5000 });
  } catch {
    // Fallback to simple fetch for basic scraping
    return webScrape(args, context);
  }

  const script = `
    const { chromium } = require('playwright');
    (async () => {
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(${JSON.stringify(url)}, { timeout: 30000 });
      const title = await page.title();
      const text = await page.evaluate(() => document.body.innerText.slice(0, 50000));
      await browser.close();
      console.log(JSON.stringify({ title, text }));
    })();
  `;

  try {
    const result = execSync(`node -e ${JSON.stringify(script)}`, { timeout: 30000, encoding: 'utf-8', cwd: context.scopePath });
    const parsed = JSON.parse(result.trim());
    return { success: true, output: `Title: ${parsed.title}\n\n${parsed.text}` };
  } catch (error) {
    return { success: false, output: `Browse failed: ${(error as Error).message}`, error: 'BROWSE_ERROR' };
  }
}
