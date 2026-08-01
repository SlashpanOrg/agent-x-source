// @ts-nocheck
// playwright is an optional runtime dependency installed in the workspace
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

interface RunRequest {
  id: string;
  type: 'run';
  task: string;
  userDataDir: string;
  headless: boolean;
  shield: boolean;
}

type ManagerMessage = RunRequest;

let context: any | null = null;
let activePage: any | null = null;
let activeUserDataDir: string | null = null;
let activeHeadless = true;

function ensureUserDataDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

async function getOrCreateContext(userDataDir: string, headless: boolean): Promise<any> {
  if (context && activeUserDataDir === userDataDir) {
    // Keep an existing visible context even if a tool asks for headless,
    // so the browser window stays open. Only switch when going from
    // headless to visible (login), or when the profile changes.
    if (activeHeadless === false || activeHeadless === headless) {
      return context;
    }
  }
  if (context) {
    try { await context.close(); } catch { /* best effort */ }
    activePage = null;
  }
  activeUserDataDir = userDataDir;
  activeHeadless = headless;
  ensureUserDataDir(userDataDir);
  context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    args: ['--no-sandbox'],
  });
  return context;
}

async function getPage(): Promise<any> {
  if (!context) throw new Error('Browser context not initialized');
  if (!activePage || activePage.isClosed()) {
    activePage = context.pages()[0] ?? await context.newPage();
  }
  return activePage;
}

async function applyShield(page: any, active: boolean, glow = true): Promise<void> {
  await page.evaluate((isActive, withGlow) => {
    const shieldId = '__agentx_input_shield__';
    const borderId = '__agentx_glow_border__';
    let shield = document.getElementById(shieldId);
    let border = document.getElementById(borderId) as HTMLElement | null;

    if (!isActive) {
      if (shield) shield.remove();
      if (border) border.remove();
      return;
    }

    if (!border) {
      border = document.createElement('div');
      border.id = borderId;
      border.style.position = 'fixed';
      border.style.inset = '0';
      border.style.pointerEvents = 'none';
      border.style.zIndex = '999998';
      if (withGlow) {
        border.style.boxShadow = 'inset 0 0 0 4px #3b82f6, 0 0 20px rgba(59, 130, 246, 0.5)';
      }
      document.body?.appendChild(border);
    }

    if (!shield) {
      shield = document.createElement('div');
      shield.id = shieldId;
      shield.style.position = 'fixed';
      shield.style.inset = '0';
      shield.style.zIndex = '999997';
      shield.style.background = 'transparent';
      shield.style.cursor = 'not-allowed';
      shield.style.userSelect = 'none';
      shield.style.webkitUserSelect = 'none';
      const stop = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
      shield.addEventListener('mousedown', stop);
      shield.addEventListener('pointerdown', stop);
      shield.addEventListener('touchstart', stop);
      shield.addEventListener('keydown', stop);
      shield.addEventListener('keyup', stop);
      shield.addEventListener('contextmenu', stop);
      shield.addEventListener('dragstart', stop);
      document.body?.appendChild(shield);
    }
  }, active, glow);
}

async function handleRun(req: RunRequest): Promise<void> {
  if (!process.send) return;
  try {
    const ctx = await getOrCreateContext(req.userDataDir, req.headless);
    const page = await getPage();

    // Make sure the page is unlocked before login or non-shielded tasks.
    if (!req.shield) {
      await applyShield(page, false, false);
    }

    const shieldHandler = req.shield
      ? () => applyShield(page, true, true).catch(() => {})
      : null;
    if (shieldHandler) {
      page.on('domcontentloaded', shieldHandler);
    }

    const fn = new Function('page', 'context', 'return (async () => { ' + req.task + ' })()');
    let result: unknown;
    try {
      result = await fn(page, ctx);
    } finally {
      if (shieldHandler) page.off('domcontentloaded', shieldHandler);
      if (req.shield) {
        await applyShield(page, false, false).catch(() => {});
      }
    }

    process.send({ id: req.id, output: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.send({ id: req.id, error: message });
  }
}

process.on('message', (msg: ManagerMessage) => {
  if (msg.type === 'run') {
    void handleRun(msg).catch((err) => {
      if (process.send) {
        const message = err instanceof Error ? err.message : String(err);
        process.send({ id: msg.id ?? 'unknown', error: message });
      } else {
        process.exit(1);
      }
    });
  }
});

process.on('disconnect', () => {
  if (context) {
    void context.close();
  }
  process.exit(0);
});
