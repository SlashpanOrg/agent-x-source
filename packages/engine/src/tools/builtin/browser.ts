import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defaultUserDataDir, runInPlaywright } from './playwright-manager.js';

let playwrightAvailable: boolean | null = null;

export function checkPlaywright(): boolean {
  if (playwrightAvailable !== null) return playwrightAvailable;
  try {
    execSync('npx playwright --version', { stdio: 'pipe', timeout: 5000 });
    playwrightAvailable = true;
  } catch {
    playwrightAvailable = false;
  }
  return playwrightAvailable;
}

function sanitizeUserDataDir(input: string | undefined, context: ToolExecutionContext): string {
  const dir = input ? resolve(context.scopePath, input) : defaultUserDataDir(context.scopePath);
  return dir;
}

export function escapeForScript(str: string): string {
  return JSON.stringify(str);
}

export async function runPlaywright(
  task: string,
  context: ToolExecutionContext,
  options: { headless?: boolean; userDataDir?: string; shield?: boolean } = {},
): Promise<string> {
  const userDataDir = sanitizeUserDataDir(options.userDataDir, context);
  const headless = options.headless !== false;
  const shield = options.shield ?? true;
  return runInPlaywright(task, { userDataDir, headless, shield });
}

export async function browserOpen(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  if (!url) return { success: false, output: 'url is required', error: 'INVALID_ARGS' };
  if (!checkPlaywright()) {
    return { success: false, output: 'Playwright not installed. Run: npx playwright install', error: 'DEPENDENCY_MISSING' };
  }

  const loginRequiredSelector = (args['login_required_selector'] as string | undefined) ?? '';
  const headless = loginRequiredSelector ? args['headless'] === true : args['headless'] !== false;
  const userDataDir = args['user_data_dir'] as string | undefined;
  const loginBannerPosition = (args['login_banner_position'] as 'top' | 'bottom' | undefined) ?? 'top';
  const maxWait = context.timeout - 5000;

  const task = `
    const url = ${escapeForScript(url)};
    const loginRequiredSelector = ${escapeForScript(loginRequiredSelector)};
    const headless = ${JSON.stringify(headless)};
    const loginBannerPosition = ${escapeForScript(loginBannerPosition)};
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
    const text = await page.evaluate((n) => (document.body ? document.body.innerText.slice(0, n) : ''), 10000);
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
    return { success: true, output: `Title: ${parsed.title}\nURL: ${parsed.url}\n\n${parsed.text ?? ''}` };
  } catch (error) {
    return { success: false, output: `Browser open failed: ${(error as Error).message}`, error: 'BROWSER_ERROR' };
  }
}

export async function browserScreenshot(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  const output = (args['output'] as string) ?? 'screenshot.png';
  if (!url) return { success: false, output: 'url is required', error: 'INVALID_ARGS' };
  if (!checkPlaywright()) {
    return { success: false, output: 'Playwright not installed. Run: npx playwright install', error: 'DEPENDENCY_MISSING' };
  }

  const headless = args['headless'] !== false;
  const userDataDir = args['user_data_dir'] as string | undefined;
  const outputPath = resolve(context.scopePath, output);

  const task = `
    const url = ${escapeForScript(url)};
    const outputPath = ${escapeForScript(outputPath)};
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: ${context.timeout - 1000} });
    await page.screenshot({ path: outputPath, fullPage: true });
    return 'ok';
  `;

  try {
    await runPlaywright(task, context, { headless, userDataDir });
    return { success: true, output: `Screenshot saved to ${output}` };
  } catch (error) {
    return { success: false, output: `Screenshot failed: ${(error as Error).message}`, error: 'BROWSER_ERROR' };
  }
}

export async function browserClick(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  const selector = args['selector'] as string;
  if (!url || !selector) return { success: false, output: 'url and selector are required', error: 'INVALID_ARGS' };
  if (!checkPlaywright()) {
    return { success: false, output: 'Playwright not installed. Run: npx playwright install', error: 'DEPENDENCY_MISSING' };
  }

  const headless = args['headless'] !== false;
  const userDataDir = args['user_data_dir'] as string | undefined;

  const task = `
    const url = ${escapeForScript(url)};
    const selector = ${escapeForScript(selector)};
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: ${context.timeout - 1000} });
    await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) throw new Error('Element not found: ' + sel);
      el.click();
    }, selector);
    await page.waitForLoadState('networkidle').catch(() => {});
    const text = await page.evaluate((n) => (document.body ? document.body.innerText.slice(0, n) : ''), 10000);
    const currentUrl = page.url();
    return JSON.stringify({ text, url: currentUrl });
  `;

  try {
    const result = await runPlaywright(task, context, { headless, userDataDir });
    const parsed = JSON.parse(result.trim()) as { text: string; url: string };
    return { success: true, output: `Clicked ${selector}. Page: ${parsed.url}\n\n${parsed.text}` };
  } catch (error) {
    return { success: false, output: `Click failed: ${(error as Error).message}`, error: 'BROWSER_ERROR' };
  }
}

export async function browserEval(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  const expression = args['expression'] as string;
  if (!url || !expression) return { success: false, output: 'url and expression are required', error: 'INVALID_ARGS' };
  if (!checkPlaywright()) {
    return { success: false, output: 'Playwright not installed. Run: npx playwright install', error: 'DEPENDENCY_MISSING' };
  }

  const headless = args['headless'] !== false;
  const userDataDir = args['user_data_dir'] as string | undefined;

  const task = `
    const url = ${escapeForScript(url)};
    const expression = ${escapeForScript(expression)};
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: ${context.timeout - 1000} });
    const result = await page.evaluate((fn) => {
      try {
        const code = JSON.parse(fn);
        return new Function('return ' + code)();
      } catch (e) {
        return { __error: String(e) };
      }
    }, expression);
    return JSON.stringify({ result });
  `;

  try {
    const result = await runPlaywright(task, context, { headless, userDataDir });
    const parsed = JSON.parse(result.trim()) as { result: unknown };
    if (parsed.result && typeof parsed.result === 'object' && (parsed.result as Record<string, unknown>)?.__error) {
      return { success: false, output: `Eval error: ${(parsed.result as Record<string, string>)['__error']}`, error: 'BROWSER_ERROR' };
    }
    const out = typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result, null, 2);
    return { success: true, output: out };
  } catch (error) {
    return { success: false, output: `Eval failed: ${(error as Error).message}`, error: 'BROWSER_ERROR' };
  }
}

export async function browserType(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  const selector = args['selector'] as string;
  const text = args['text'] as string;
  if (!url || !selector || !text) return { success: false, output: 'url, selector, and text are required', error: 'INVALID_ARGS' };
  if (!checkPlaywright()) {
    return { success: false, output: 'Playwright not installed. Run: npx playwright install', error: 'DEPENDENCY_MISSING' };
  }

  const headless = args['headless'] !== false;
  const userDataDir = args['user_data_dir'] as string | undefined;

  const task = `
    const url = ${escapeForScript(url)};
    const selector = ${escapeForScript(selector)};
    const text = ${escapeForScript(text)};
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: ${context.timeout - 1000} });
    await page.evaluate(([sel, value]) => {
      const el = document.querySelector(sel) as HTMLInputElement | null;
      if (!el) throw new Error('Element not found: ' + sel);
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, [selector, text]);
    return 'ok';
  `;

  try {
    await runPlaywright(task, context, { headless, userDataDir });
    return { success: true, output: `Typed "${text}" into ${selector} on ${url}` };
  } catch (error) {
    return { success: false, output: `Type failed: ${(error as Error).message}`, error: 'BROWSER_ERROR' };
  }
}

export async function browserExtract(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  const selector = args['selector'] as string;
  if (!url || !selector) return { success: false, output: 'url and selector are required', error: 'INVALID_ARGS' };
  if (!checkPlaywright()) {
    return { success: false, output: 'Playwright not installed. Run: npx playwright install', error: 'DEPENDENCY_MISSING' };
  }

  const headless = args['headless'] !== false;
  const userDataDir = args['user_data_dir'] as string | undefined;

  const task = `
    const url = ${escapeForScript(url)};
    const selector = ${escapeForScript(selector)};
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: ${context.timeout - 1000} });
    const elements = await page.$$eval(selector, (els) => els.map((el) => (el.textContent?.trim() || '')));
    return JSON.stringify({ elements, count: elements.length });
  `;

  try {
    const result = await runPlaywright(task, context, { headless, userDataDir });
    const parsed = JSON.parse(result.trim()) as { elements: string[]; count: number };
    return { success: true, output: parsed.elements.join('\n\n'), metadata: { count: parsed.count } };
  } catch (error) {
    return { success: false, output: `Extract failed: ${(error as Error).message}`, error: 'BROWSER_ERROR' };
  }
}
