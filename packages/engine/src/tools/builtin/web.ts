import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { markdownSourceLink, prefixWebExtractOutput, assertSafeFetchUrl } from '../../search/url-utils.js';
import { checkPlaywright, runPlaywright } from './browser.js';

function blockedUrlResult(url: string): ToolResult {
  return { success: false, output: `URL blocked by SSRF policy: ${url}`, error: 'SSRF_BLOCKED' };
}

function guardFetchUrl(url: string): ToolResult | null {
  try {
    assertSafeFetchUrl(url);
    return null;
  } catch {
    return blockedUrlResult(url);
  }
}

export async function httpGet(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  const headers = (args['headers'] as Record<string, string>) ?? {};

  try {
    assertSafeFetchUrl(url);
  } catch {
    return blockedUrlResult(url);
  }

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
      output: prefixWebExtractOutput(url, body),
      metadata: { status: response.status, contentType, url },
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

  const blocked = guardFetchUrl(url);
  if (blocked) return blocked;

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

  const blocked = guardFetchUrl(url);
  if (blocked) return blocked;

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

  const blocked = guardFetchUrl(url);
  if (blocked) return blocked;

  try {
    const { hybridFetchAndExtract } = await import('../../search/hybrid-extract.js');
    const result = await hybridFetchAndExtract(url, { timeout: 15000 });

    let output = result.markdown || result.text;
    if (!output) {
      return { success: false, output: `Scrape returned no content: ${result.reason}`, error: 'SCRAPE_EMPTY' };
    }

    if (selector) {
      output = `(CSS selector "${selector}" requires browser — returning full extracted content)\n${output}`;
    }

    if (output.length > 30000) output = output.slice(0, 30000) + '\n...(truncated)';

    return {
      success: true,
      output: prefixWebExtractOutput(url, output),
      metadata: {
        url,
        length: output.length,
        extractor: result.winner,
        extractorReason: result.reason,
        trafilaturaQuality: result.trafilaturaQuality,
        agentFetchMethod: result.agentFetchMethod,
        overlap: result.overlap,
        hasTables: result.hasTables,
      },
    };
  } catch (error) {
    return { success: false, output: (error as Error).message, error: 'SCRAPE_ERROR' };
  }
}

export async function webSearch(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
  const query = String(args['query'] ?? '').trim();
  if (!query) {
    return { success: false, output: 'query is required', error: 'MISSING_INPUT' };
  }

  try {
    const { runWebSearch, describeActiveWebSearchProviders } = await import('../../search/providers/index.js');
    const { hasActiveWebSearchProviders, webSearchProvidersUnavailableMessage } = await import('../../search/search-config.js');
    if (!hasActiveWebSearchProviders()) {
      return {
        success: false,
        output: webSearchProvidersUnavailableMessage(),
        error: 'NO_SEARCH_PROVIDERS',
        metadata: { query, resultCount: 0 },
      };
    }
    const hits = await runWebSearch(query, 8);

    if (hits.length === 0) {
      const providers = describeActiveWebSearchProviders();
      return {
        success: true,
        output: `Web search completed with no results (queried: ${providers}). The providers are enabled — try rephrasing the query, a shorter topic, or use http_get on a known URL.`,
        metadata: { query, resultCount: 0, providers: providers.split(',').map((p) => p.trim()) },
      };
    }

    const lines = hits.map((h, i) => {
      const source = markdownSourceLink(h.url);
      return `${i + 1}. ${h.title}\n   ${h.snippet || '(no snippet)'}\n   Source: ${source} [${h.provider}]`;
    });

    return {
      success: true,
      output: lines.join('\n\n'),
      metadata: {
        query,
        resultCount: hits.length,
        providers: [...new Set(hits.map((h) => h.provider))],
        sources: hits.map((h) => h.url),
      },
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

  const blocked = guardFetchUrl(url);
  if (blocked) return blocked;

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

  const blocked = guardFetchUrl(url);
  if (blocked) return blocked;

  // Check if Playwright is available
  if (!checkPlaywright()) {
    // Fallback to simple fetch for basic scraping
    return webScrape(args, context);
  }

  const loginRequiredSelector = (args['login_required_selector'] as string | undefined) ?? '';
  const headless = loginRequiredSelector ? args['headless'] === true : args['headless'] !== false;
  const userDataDir = args['user_data_dir'] as string | undefined;
  const loginBannerPosition = (args['login_banner_position'] as 'top' | 'bottom' | undefined) ?? 'top';
  const maxWait = context.timeout - 5000;

  const task = `
    const url = ${JSON.stringify(url)};
    const loginRequiredSelector = ${JSON.stringify(loginRequiredSelector)};
    const headless = ${JSON.stringify(headless)};
    const loginBannerPosition = ${JSON.stringify(loginBannerPosition)};
    const maxWait = ${maxWait};
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: ${context.timeout - 1000} });
    const checkLogin = async () => loginRequiredSelector ? (await page.locator(loginRequiredSelector).count()) > 0 : false;
    const title = await page.title();
    const currentUrl = page.url();
    if (loginRequiredSelector && await checkLogin()) {
      if (headless) {
        return JSON.stringify({ loginRequired: true, title, url: currentUrl });
      } else {
        await page.evaluate(() => localStorage.removeItem('__agentx_continue__'));
        const injectBanner = async () => {
          await page.evaluate((position) => {
            const id = '__agentx_login_banner__';
            let el = document.getElementById(id);
            if (!el && document.body) {
              el = document.createElement('div');
              el.id = id;
              el.style.position = 'fixed';
              el.style[position] = '0';
              el.style.left = '0';
              el.style.width = '100%';
              el.style.height = '42px';
              el.style.background = '#111827';
              el.style.color = '#ffffff';
              el.style.zIndex = '999999';
              el.style.display = 'flex';
              el.style.alignItems = 'center';
              el.style.justifyContent = 'space-between';
              el.style.padding = '0 16px';
              el.style.fontFamily = 'system-ui, sans-serif';
              el.style.fontSize = '14px';
              el.style.boxSizing = 'border-box';
              el.innerHTML = '<span>Agent-X: Please log in to this site, then click Continue.</span><button id="__agentx_continue_btn__" style="background:#10b981;border:none;border-radius:4px;color:#fff;padding:6px 14px;cursor:pointer;font-weight:600;">Continue</button>';
              document.body.appendChild(el);
              const btn = document.getElementById('__agentx_continue_btn__');
              if (btn) btn.onclick = () => localStorage.setItem('__agentx_continue__', '1');
            }
          }, loginBannerPosition);
        };
        page.on('domcontentloaded', () => { injectBanner().catch(() => {}); });
        await injectBanner();
        const start = Date.now();
        let done = false;
        while (Date.now() - start < maxWait) {
          try {
            done = await page.evaluate(() => localStorage.getItem('__agentx_continue__') === '1');
          } catch { /* navigation or frame detached; keep polling */ }
          if (done) break;
          await page.waitForTimeout(500);
        }
        if (!done) throw new Error('Login wait timed out');
        await page.evaluate(() => localStorage.removeItem('__agentx_continue__'));
        if (await checkLogin()) {
          const loginTitle = await page.title();
          const loginUrl = page.url();
          return JSON.stringify({ loginFailed: true, title: loginTitle, url: loginUrl, reason: 'Login selector is still present after Continue.' });
        }
      }
    }
    const finalTitle = await page.title();
    const finalUrl = page.url();
    const text = await page.evaluate((n) => (document.body ? document.body.innerText.slice(0, n) : ''), 50000);
    return JSON.stringify({ title: finalTitle, text, url: finalUrl });
  `;

  try {
    const result = await runPlaywright(task, context, { headless, userDataDir, shield: !loginRequiredSelector });
    const parsed = JSON.parse(result.trim()) as { loginRequired?: boolean; loginFailed?: boolean; title: string; text?: string; url: string; reason?: string };
    if (parsed.loginRequired) {
      return {
        success: false,
        output: `Login required on "${parsed.title}" (${parsed.url}). Please log in to this site in the opened browser, then click Continue or say "continue" to proceed.`,
        error: 'LOGIN_REQUIRED',
        metadata: { url: parsed.url, title: parsed.title },
      };
    }
    if (parsed.loginFailed) {
      return { success: false, output: `Login not completed on "${parsed.title}" (${parsed.url}). ${parsed.reason ?? ''}`, error: 'LOGIN_FAILED' };
    }
    return { success: true, output: `Title: ${parsed.title}\n\n${parsed.text ?? ''}` };
  } catch (error) {
    return { success: false, output: `Browse failed: ${(error as Error).message}`, error: 'BROWSE_ERROR' };
  }
}
